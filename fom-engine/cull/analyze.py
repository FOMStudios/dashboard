"""Measure every photo: sharpness where it matters, exposure, white balance, faces, eyes,
smiles, who is in it, how similar it is to its neighbours, a beauty score and the horizon.

Models (setup.sh puts them in models/):
  face_detection_yunet_2023mar.onnx    finds faces (OpenCV YuNet)
  face_recognition_sface_2021dec.onnx  tells people apart (OpenCV SFace), used for priority people
  face_landmarker.task                 eye blink and smile scores (MediaPipe)
  sa_0_4_vit_b_32_linear.pth           beauty score head on top of CLIP ViT-B-32 (LAION)
Every model is optional: if one is missing that measurement is skipped and the cull still runs.
"""
import os, math
import numpy as np
import cv2
from multiprocessing import Pool

from common import MODELS, cache_dir, progress, log

M_YUNET = os.path.join(MODELS, 'face_detection_yunet_2023mar.onnx')
M_SFACE = os.path.join(MODELS, 'face_recognition_sface_2021dec.onnx')
M_LAND = os.path.join(MODELS, 'face_landmarker.task')
M_AES = os.path.join(MODELS, 'sa_0_4_vit_b_32_linear.pth')

_W = {}   # per-process models


def _init_worker():
    cv2.setNumThreads(1)
    _W['yunet'] = None
    _W['sface'] = None
    _W['land'] = None
    _W['haar'] = None
    try:
        if os.path.exists(M_YUNET):
            _W['yunet'] = cv2.FaceDetectorYN.create(M_YUNET, '', (320, 320), 0.72, 0.3, 60)
    except Exception as ex:
        log('yunet', ex)
    try:
        if os.path.exists(M_SFACE):
            _W['sface'] = cv2.FaceRecognizerSF.create(M_SFACE, '')
    except Exception as ex:
        log('sface', ex)
    try:
        if os.path.exists(M_LAND):
            import mediapipe as mp
            from mediapipe.tasks import python as mpt
            from mediapipe.tasks.python import vision
            opts = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=M_LAND),
                                                output_face_blendshapes=True, num_faces=1,
                                                running_mode=vision.RunningMode.IMAGE)
            _W['land'] = vision.FaceLandmarker.create_from_options(opts)
            _W['mp'] = mp
    except Exception as ex:
        log('landmarker', ex)
    if _W['yunet'] is None:
        try:
            hd = cv2.data.haarcascades
            _W['haar'] = (cv2.CascadeClassifier(hd + 'haarcascade_frontalface_default.xml'),
                          cv2.CascadeClassifier(hd + 'haarcascade_eye_tree_eyeglasses.xml'))
        except Exception as ex:
            log('haar', ex)


def capabilities():
    caps = {'faces': os.path.exists(M_YUNET), 'people': os.path.exists(M_SFACE), 'eyes': os.path.exists(M_LAND),
            'beauty': os.path.exists(M_AES), 'clip': False}
    try:
        import torch, open_clip  # noqa
        caps['clip'] = True
    except Exception:
        pass
    return caps


def _lapvar(g):
    if g.size < 64:
        return 0.0
    return float(cv2.Laplacian(g, cv2.CV_64F, ksize=3).var())


def _tile_sharp(g):
    h, w = g.shape
    rows, cols = (6, 8) if w >= h else (8, 6)
    vals = []
    for r in range(rows):
        for c in range(cols):
            t = g[r * h // rows:(r + 1) * h // rows, c * w // cols:(c + 1) * w // cols]
            vals.append(_lapvar(t))
    vals.sort(reverse=True)
    top = vals[:3]
    return float(np.mean(top)), float(np.median(vals))


def _exposure(g):
    hist = np.bincount(g.ravel(), minlength=256).astype(np.float64)
    n = hist.sum() or 1
    cdf = np.cumsum(hist) / n
    pct = lambda q: int(np.searchsorted(cdf, q))
    return {'mean': float((hist * np.arange(256)).sum() / n), 'p01': pct(0.01), 'p05': pct(0.05), 'p50': pct(0.5),
            'p95': pct(0.95), 'p99': pct(0.99), 'hi': float(hist[250:].sum() / n), 'lo': float(hist[:6].sum() / n)}


def _wb(rgb):
    f = rgb.reshape(-1, 3).astype(np.float32) / 255.0
    mx, mn = f.max(1), f.min(1)
    lum = f.mean(1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    m = (sat < 0.18) & (lum > 0.15) & (lum < 0.9)
    cover = float(m.mean())
    if cover < 0.02:
        m = (lum > 0.15) & (lum < 0.9)
    if m.sum() < 50:
        return {'rg': 0.0, 'bg': 0.0, 'cover': 0.0}
    r, g, b = [float(x) for x in f[m].mean(0)]
    g = max(g, 1e-3)
    return {'rg': math.log(max(r, 1e-3) / g), 'bg': math.log(max(b, 1e-3) / g), 'cover': cover}


def _horizon(g):
    h, w = g.shape
    s = 900.0 / max(h, w)
    sm = cv2.resize(g, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    e = cv2.Canny(cv2.GaussianBlur(sm, (3, 3), 0), 60, 160)
    lines = cv2.HoughLinesP(e, 1, np.pi / 720, 80, minLineLength=int(sm.shape[1] * 0.22), maxLineGap=8)
    if lines is None:
        return None
    angs, wts = [], []
    for x1, y1, x2, y2 in lines.reshape(-1, 4):
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy)
        a = math.degrees(math.atan2(dy, dx))
        if a > 90: a -= 180
        if a < -90: a += 180
        if abs(a) <= 8:                      # near horizontal
            angs.append(a); wts.append(L)
        elif abs(abs(a) - 90) <= 8:          # near vertical (buildings, poles)
            angs.append((a - 90) if a > 0 else (a + 90)); wts.append(L * 0.6)
    if not angs:
        return None
    o = np.argsort(angs)
    a, wt = np.array(angs)[o], np.array(wts)[o]
    c = np.cumsum(wt)
    med = float(a[np.searchsorted(c, c[-1] / 2)])
    spread = float(np.sqrt(np.average((a - med) ** 2, weights=wt)))
    conf = float(min(1.0, c[-1] / (sm.shape[1] * 1.5)) * (1.0 if spread < 1.5 else 0.5))
    return {'a': round(med, 2), 'c': round(conf, 2)}


def _faces(bgr, rgb, g):
    H, W = g.shape
    out = []
    if _W.get('yunet') is not None:
        det = _W['yunet']
        det.setInputSize((W, H))
        _, faces = det.detect(bgr)
        faces = [] if faces is None else faces
        for f in faces:
            x, y, w, h = [float(v) for v in f[:4]]
            if w < 18 or h < 18:
                continue
            lm = f[4:14].reshape(5, 2)
            rec = {'b': [round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)], 's': round(float(f[14]), 3)}
            ed = float(np.linalg.norm(lm[0] - lm[1])) or 1.0
            rec['yaw'] = round(float((lm[2][0] - (lm[0][0] + lm[1][0]) / 2) / ed), 3)
            x0, y0 = max(0, int(x)), max(0, int(y))
            crop = g[y0:int(y + h), x0:int(x + w)]
            rec['sh'] = round(math.log1p(_lapvar(crop)), 3) if crop.size else 0
            if _W.get('sface') is not None and w >= 40:
                try:
                    al = _W['sface'].alignCrop(bgr, f)
                    v = _W['sface'].feature(al).flatten()
                    v = v / (np.linalg.norm(v) or 1)
                    rec['e'] = [round(float(z), 4) for z in v]
                except Exception:
                    pass
            if _W.get('land') is not None and w >= 30:
                try:
                    cx, cy, sz = x + w / 2, y + h / 2, max(w, h) * 1.7
                    a, b = int(max(0, cx - sz / 2)), int(max(0, cy - sz / 2))
                    c, d = int(min(W, cx + sz / 2)), int(min(H, cy + sz / 2))
                    cr = np.ascontiguousarray(rgb[b:d, a:c])
                    if cr.shape[0] > 20 and cr.shape[1] > 20:
                        if max(cr.shape[:2]) < 192:
                            k = 192.0 / max(cr.shape[:2])
                            cr = np.ascontiguousarray(cv2.resize(cr, (int(cr.shape[1] * k), int(cr.shape[0] * k))))
                        mp = _W['mp']
                        res = _W['land'].detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cr))
                        if res.face_blendshapes:
                            bs = {c.category_name: c.score for c in res.face_blendshapes[0]}
                            bl = max(bs.get('eyeBlinkLeft', 0), bs.get('eyeBlinkRight', 0))
                            rec['blink'] = round(float(bl), 3)
                            rec['eo'] = round(float(1 - min(1, max(0, (bl - 0.3) / 0.35))), 3)
                            rec['smile'] = round(float((bs.get('mouthSmileLeft', 0) + bs.get('mouthSmileRight', 0)) / 2), 3)
                except Exception as ex:
                    log('blendshapes', ex)
            out.append(rec)
    elif _W.get('haar') is not None:
        fc, ec = _W['haar']
        s = 800.0 / max(H, W)
        sm = cv2.resize(g, (int(W * s), int(H * s)))
        for (x, y, w, h) in fc.detectMultiScale(sm, 1.15, 6, minSize=(28, 28)):
            rec = {'b': [round(x / sm.shape[1], 4), round(y / sm.shape[0], 4), round(w / sm.shape[1], 4), round(h / sm.shape[0], 4)], 's': 0.8, 'yaw': 0}
            X, Y, Wd, Ht = int(x / s), int(y / s), int(w / s), int(h / s)
            crop = g[Y:Y + Ht, X:X + Wd]
            rec['sh'] = round(math.log1p(_lapvar(crop)), 3)
            # no eye model: faces count, but eyes are not judged (Haar eyes are too unreliable)
            out.append(rec)
    return out


def _one(job):
    pid, path = job
    try:
        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if bgr is None:
            return pid, None
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        top, med = _tile_sharp(g)
        r = {'sg': round(math.log1p(_lapvar(g)), 3), 'st': round(math.log1p(top), 3), 'sm': round(math.log1p(med), 3)}
        r['ex'] = _exposure(g)
        r['wb'] = _wb(cv2.resize(rgb, (rgb.shape[1] // 4, rgb.shape[0] // 4)))
        r['hz'] = _horizon(g)
        r['faces'] = _faces(bgr, rgb, g)
        hsv = cv2.cvtColor(cv2.resize(bgr, (160, 120)), cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [12, 4], [0, 180, 0, 256]).flatten()
        r['hist'] = [round(float(v), 4) for v in hist / (hist.sum() or 1)]
        try:
            import imagehash
            from PIL import Image
            r['ph'] = str(imagehash.phash(Image.fromarray(cv2.resize(rgb, (256, 256)))))
        except Exception:
            small = cv2.resize(g, (9, 8))
            r['ph'] = '%016x' % int(''.join('1' if b else '0' for b in (small[:, 1:] > small[:, :-1]).flatten()), 2)
        return pid, r
    except Exception as ex:
        log('analyse failed', pid, ex)
        return pid, None


def _clip_and_beauty(ids, paths):
    """CLIP embeddings (similar photos, best of a group) and the LAION beauty score."""
    try:
        import torch, open_clip
        from PIL import Image
    except Exception:
        return None, None
    dev = 'mps' if torch.backends.mps.is_available() else 'cuda' if torch.cuda.is_available() else 'cpu'
    try:
        model, _, pre = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai', cache_dir=os.path.join(MODELS, 'clip'))
    except Exception as ex:
        log('clip load', ex)
        return None, None
    model = model.to(dev).eval()
    head = None
    if os.path.exists(M_AES):
        try:
            head = torch.nn.Linear(512, 1)
            head.load_state_dict(torch.load(M_AES, map_location='cpu'))
            head = head.to(dev).eval()
        except Exception as ex:
            log('beauty head', ex)
            head = None
    embs, aes = [], []
    B = 32
    with torch.no_grad():
        for i in range(0, len(paths), B):
            ims = []
            for p in paths[i:i + B]:
                try:
                    ims.append(pre(Image.open(p).convert('RGB')))
                except Exception:
                    ims.append(torch.zeros(3, 224, 224))
            x = torch.stack(ims).to(dev)
            e = model.encode_image(x).float()
            e = e / e.norm(dim=-1, keepdim=True)
            embs.append(e.cpu().numpy())
            if head is not None:
                aes.extend(head(e).flatten().cpu().numpy().tolist())
            progress('beauty', min(i + B, len(paths)), len(paths), 'Scoring looks and finding similar shots')
    return np.concatenate(embs), (aes if head is not None else None)


def analyze(folder, photos):
    cdir = cache_dir(folder)
    jobs = [(p['id'], os.path.join(cdir, 'prev', p['id'] + '.jpg')) for p in photos]
    byid = {p['id']: p for p in photos}
    n = len(jobs)
    progress('analyse', 0, n, 'Checking focus, eyes and faces')
    procs = max(2, min(6, (os.cpu_count() or 4) - 2))
    done = 0
    with Pool(procs, initializer=_init_worker) as pool:
        for pid, r in pool.imap_unordered(_one, jobs, chunksize=4):
            done += 1
            if r:
                byid[pid]['a'] = r
            if done % 10 == 0 or done == n:
                progress('analyse', done, n, 'Checking focus, eyes and faces')
    good = [p for p in photos if 'a' in p]
    emb, aes = _clip_and_beauty([p['id'] for p in good], [os.path.join(cdir, 'prev', p['id'] + '.jpg') for p in good])
    if emb is not None:
        np.save(os.path.join(cdir, 'clip.npy'), emb)
        with open(os.path.join(cdir, 'clip_ids.txt'), 'w') as f:
            f.write('\n'.join(p['id'] for p in good))
    if aes is not None:
        for p, v in zip(good, aes):
            p['a']['aes'] = round(float(v), 3)
    return good


def load_clip(folder):
    cdir = cache_dir(folder)
    try:
        emb = np.load(os.path.join(cdir, 'clip.npy'))
        ids = open(os.path.join(cdir, 'clip_ids.txt')).read().split('\n')
        return {i: emb[k] for k, i in enumerate(ids)}
    except Exception:
        return {}
