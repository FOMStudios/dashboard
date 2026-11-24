"""Learning, both kinds, kept on the Mac in learn/:

1. Your final picks (picks-<job>.jsonl, picks-<job>.json)
   After you finish a job in Lightroom, choose the folder you exported the finals to.
   The finals are matched back to the culled photos (by file name, then by capture time)
   and every photo becomes a lesson: kept by you, or not. A small model per job type then
   nudges future culls towards your taste. Its say grows with every job (up to 60%).

2. Your edits (edit-<biz>-<job>.json and look-<biz>-<job>.xmp)
   Export finished shoots from Lightroom as "Original + Settings". The cull reads your
   sliders from the XMP, learns how you set exposure, white balance and tone for how a
   photo looks out of camera, and keeps your typical look (profile, curve, colour, grain)
   as a starter.
Same cull rules for both businesses, so the pick model is shared; edits stay per business.
"""
import os, re, json, math, glob, shutil, subprocess, tempfile, time
import numpy as np

from common import LEARN, RAW_EXT, JPG_EXT, HEIC_EXT, IMG_EXT, exiftool_bin, read_json, write_json, load_state, save_state, progress, log

FEATS = ['sharp', 'beauty', 'eyes', 'smile', 'expo', 'face', 'look', 'level', 'prio']


def features(p, job):
    parts = p.get('_parts') or (p.get('d') or {}).get('pt') or {}
    x = [float(parts.get(k, 0)) for k in FEATS]
    # derived the same way at cull time and at learning time
    blink = 1.0 if parts.get('face') and parts.get('eyes', 1) < 0.35 else 0.0
    soft = 1.0 if parts.get('sharp', 1) < 0.12 else 0.0
    x += [blink, soft]
    return np.array(x)


def learned_model(job):
    m = read_json(os.path.join(LEARN, 'picks-%s.json' % job))
    if not m or m.get('n', 0) < 150:
        return None
    m['w'] = np.array(m['w'])
    return m


def _fit_logistic(X, y, l2=0.02, it=1500, lr=0.5):
    n, d = X.shape
    w = np.zeros(d)
    b = 0.0
    pos = y.mean() if n else 0.5
    cw = np.where(y > 0.5, 0.5 / max(pos, 1e-3), 0.5 / max(1 - pos, 1e-3))   # balance kept / not kept
    for _ in range(it):
        z = X @ w + b
        pr = 1 / (1 + np.exp(-np.clip(z, -30, 30)))
        g = (pr - y) * cw
        w -= lr * (X.T @ g / n + l2 * w)
        b -= lr * g.mean()
    return w, b


def _norm_stem(name):
    s = os.path.splitext(os.path.basename(name))[0]
    s = re.sub(r'(-|_| )(edit|enhanced|nr|hdr|pano)(-\d+)?$', '', s, flags=re.I)
    s = re.sub(r' ?\(\d+\)$', '', s)
    s = re.sub(r'-\d{1,2}$', '', s)
    return s.lower()


def _times(files):
    if not files:
        return {}
    with tempfile.NamedTemporaryFile('w', suffix='.args', delete=False) as af:
        af.write('\n'.join(files)); argf = af.name
    try:
        r = subprocess.run([exiftool_bin(), '-j', '-n', '-fast', '-DateTimeOriginal', '-SubSecTimeOriginal', '-SubSecDateTimeOriginal', '-@', argf],
                           capture_output=True, text=True, timeout=900)
        data = json.loads(r.stdout or '[]')
    except Exception:
        data = []
    finally:
        os.unlink(argf)
    from scan import _exif_time
    return {os.path.realpath(d['SourceFile']): _exif_time(d) for d in data}


def list_images(folder):
    out = []
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if not f.startswith('.') and os.path.splitext(f)[1].lower() in IMG_EXT:
                out.append(os.path.join(root, f))
    return sorted(out)


def match_finals(st, finals_folder):
    photos = [p for p in st['photos'] if 'd' in p]
    files = list_images(finals_folder)
    by_stem = {}
    for p in photos:
        for f in p['files']:
            by_stem.setdefault(_norm_stem(f), p['id'])
    matched, left = set(), []
    for f in files:
        pid = by_stem.get(_norm_stem(f))
        if pid:
            matched.add(pid)
        else:
            left.append(f)
    if left:
        ts = _times(left)
        tl = sorted([(p.get('t') or 0, p['id']) for p in photos if p.get('t')])
        arr = np.array([t for t, _ in tl]) if tl else np.array([])
        for f in left:
            t = ts.get(os.path.realpath(f), 0)
            if not t or not len(arr):
                continue
            i = int(np.argmin(np.abs(arr - t)))
            if abs(arr[i] - t) < 0.02 or (abs(arr[i] - t) < 1 and sum(1 for x in arr if abs(x - t) < 1) == 1):
                matched.add(tl[i][1])
    return matched, len(files)


def learn_picks(folder, finals_folder):
    st = load_state(folder)
    if not st:
        raise SystemExit('This folder has not been culled yet.')
    job = st.get('job', 'events')
    kept, nfin = match_finals(st, finals_folder)
    photos = [p for p in st['photos'] if 'd' in p]
    if not kept:
        return {'ok': False, 'msg': 'None of the %d finals matched this shoot. Export with the original file names, or keep the capture time.' % nfin}
    from decide import final_cat
    rows_path = os.path.join(LEARN, 'picks-%s.jsonl' % job)
    shoot = os.path.basename(os.path.normpath(folder))
    # replace earlier lessons from this same shoot
    old = []
    if os.path.exists(rows_path):
        with open(rows_path) as f:
            old = [json.loads(l) for l in f if l.strip()]
        old = [r for r in old if r.get('shoot') != st.get('sid')]
    rows = [{'x': [round(v, 4) for v in features(p, job).tolist()], 'y': 1 if p['id'] in kept else 0, 'biz': st.get('biz'), 'shoot': st.get('sid'), 't': time.time()} for p in photos]
    with open(rows_path, 'w') as f:
        for r in old + rows:
            f.write(json.dumps(r) + '\n')
    allr = old + rows
    X = np.array([r['x'] for r in allr])
    y = np.array([r['y'] for r in allr], dtype=float)
    w, b = _fit_logistic(X, y)
    pos = int(y.sum())
    model = {'job': job, 'w': [round(float(v), 4) for v in w], 'b': round(float(b), 4), 'n': len(allr), 'pos': pos,
             'alpha': round(min(0.6, 0.12 * len(set(r.get('shoot') for r in allr)), pos / 400.0), 3), 'feats': FEATS + ['blink', 'soft'], 'updated': time.time(),
             'shoots': len(set(r.get('shoot') for r in allr))}
    write_json(os.path.join(LEARN, 'picks-%s.json' % job), model)

    ai = {p['id'] for p in photos if final_cat(p) in ('keep', 'hl')}
    agree = len(ai & kept)
    recall = agree / len(kept) if kept else 0
    precision = agree / len(ai) if ai else 0
    # what you favour compared with what the cull picked
    tips = []
    if ai and kept:
        A = np.array([features(p, job) for p in photos if p['id'] in ai]).mean(0)
        K = np.array([features(p, job) for p in photos if p['id'] in kept]).mean(0)
        names = {'smile': ('more smiles', 'fewer big smiles'), 'eyes': ('only open eyes', 'some half-closed eyes'),
                 'sharp': ('only the sharpest', 'some softer frames'), 'beauty': ('the prettier frames', 'moments over looks'),
                 'face': ('more faces', 'more details and scenes'), 'prio': ('more of your priority people', 'fewer of the priority people'),
                 'look': ('people looking at camera', 'more candids'), 'level': ('straight horizons', 'tilted angles')}
        diffs = []
        for i, k in enumerate(FEATS):
            if k in names:
                diffs.append((K[i] - A[i], k))
        for d, k in sorted(diffs, key=lambda x: -abs(x[0]))[:3]:
            if abs(d) >= 0.04:
                tips.append('You kept ' + names[k][0 if d > 0 else 1])
    missed = len(kept - ai)
    hist = read_json(os.path.join(LEARN, 'history.json'), []) or []
    hist = [h for h in hist if h.get('sid') != st.get('sid')]
    rec = {'t': time.time(), 'sid': st.get('sid'), 'shoot': shoot, 'biz': st.get('biz'), 'job': job, 'photos': len(photos),
           'finals': nfin, 'matched': len(kept), 'ai': len(ai), 'agree': agree, 'recall': round(recall, 3),
           'precision': round(precision, 3), 'missed': missed, 'tips': tips}
    hist.append(rec)
    write_json(os.path.join(LEARN, 'history.json'), hist[-200:])
    st['learned'] = rec
    st['finals'] = sorted(kept)
    save_state(folder, st)
    out = {'ok': True, 'rec': rec, 'model': {'n': model['n'], 'alpha': model['alpha'], 'shoots': model['shoots']}}
    # finals exported as "Original + Settings" also teach your editing
    if any(os.path.exists(os.path.splitext(f)[0] + '.xmp') for f in list_images(finals_folder)[:400]):
        try:
            out['edits'] = learn_edits(finals_folder, st.get('biz', 'fom'), job)
        except Exception as ex:
            log('learn edits', ex)
    return out


# ---------------------------------------------------------------- edits
TARGETS = ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012',
           'Temperature', 'Tint', 'Vibrance', 'Saturation']
LOCAL_TAGS = ['MaskGroupBasedCorrections', 'RetouchAreas', 'CircularGradientBasedCorrections', 'GradientBasedCorrections',
              'PaintBasedCorrections', 'CropTop', 'CropLeft', 'CropBottom', 'CropRight', 'CropAngle', 'HasCrop',
              'CropConstrainToWarp', 'CropUnit', 'CropWidth', 'CropHeight', 'RetouchInfo', 'RedEye', 'SpotRemoval',
              'Exposure2012', 'WhiteBalance', 'Temperature', 'Tint', 'AutoLateralCA', 'RawFileName', 'Name']   # per photo, not part of the look


def _num(v):
    try:
        return float(v)
    except Exception:
        return None


def edit_feats(a, asTemp, iso):
    ex, wb = a['ex'], a['wb']
    return np.array([1.0, ex['mean'] / 255, ex['p05'] / 255, ex['p50'] / 255, ex['p95'] / 255, ex['hi'], ex['lo'],
                     wb['rg'], wb['bg'], math.log(max(iso or 100, 50)) / 10, (1e6 / asTemp / 1000) if asTemp else 0.18])


def _read_crs(paths):
    if not paths:
        return []
    with tempfile.NamedTemporaryFile('w', suffix='.args', delete=False) as af:
        af.write('\n'.join(paths)); argf = af.name
    try:
        r = subprocess.run([exiftool_bin(), '-j', '-n', '-XMP-crs:all', '-ISO', '-ColorTempAsShot', '-@', argf], capture_output=True, text=True, timeout=1800)
        return json.loads(r.stdout or '[]')
    except Exception as ex:
        log('read crs', ex)
        return []
    finally:
        os.unlink(argf)


def learn_edits(folder, biz, job):
    """folder: a Lightroom export with Original + Settings (RAW + .xmp), or files with settings inside."""
    from scan import scan
    from analyze import _init_worker, _one
    imgs = list_images(folder)
    pairs = []   # (image, settings source)
    for f in imgs:
        x = os.path.splitext(f)[0] + '.xmp'
        if os.path.exists(x):
            pairs.append((f, x))
        elif os.path.splitext(f)[1].lower() in JPG_EXT | {'.dng'} | HEIC_EXT:
            pairs.append((f, f))
    progress('learn', 0, len(pairs), 'Reading your edits')
    meta = {os.path.realpath(d['SourceFile']): d for d in _read_crs([s for _, s in pairs] + [i for i, s in pairs if s != i])}
    photos = scan(folder)
    byfile = {}
    for p in photos:
        for f in p['files']:
            byfile[os.path.realpath(os.path.join(folder, f))] = p
    from common import cache_dir
    cdir = cache_dir(folder)
    _init_worker()
    rows = []
    for k, (img, src) in enumerate(pairs):
        m = dict(meta.get(os.path.realpath(src)) or {})
        for kk in TARGETS + ['Clarity2012', 'Texture', 'Dehaze']:
            if kk in m:
                m[kk] = _num(m[kk])
        if not m.get('ProcessVersion') and m.get('Exposure2012') is None:
            continue
        p = byfile.get(os.path.realpath(img))
        if not p:
            continue
        _, a = _one((p['id'], os.path.join(cdir, 'prev', p['id'] + '.jpg')))
        if not a:
            continue
        im = meta.get(os.path.realpath(img)) or m
        raw = os.path.splitext(img)[1].lower() in RAW_EXT
        rows.append({'f': edit_feats(a, im.get('ColorTempAsShot') or 0, im.get('ISO') or 0), 'm': m, 'raw': raw, 'src': src})
        progress('learn', k + 1, len(pairs), 'Reading your edits')
    if len(rows) < 20:
        return {'ok': False, 'msg': 'Found %d edited photos with settings. Export at least 20 (ideally a few hundred) as Original + Settings.' % len(rows)}
    X = np.array([r['f'] for r in rows])
    model = {'biz': biz, 'job': job, 'n': len(rows), 'updated': time.time(), 't': {}}
    for t in TARGETS:
        idx = [i for i, r in enumerate(rows) if isinstance(r['m'].get(t), (int, float)) and (r['raw'] or t not in ('Temperature', 'Tint'))]
        if len(idx) < max(15, 0.5 * len(rows)):
            continue
        y = np.array([float(rows[i]['m'][t]) for i in idx])
        Xi = X[idx]
        lam = 0.5
        w = np.linalg.solve(Xi.T @ Xi + lam * np.eye(Xi.shape[1]), Xi.T @ y)
        model['t'][t] = {'w': [round(float(v), 5) for v in w], 'lo': float(np.percentile(y, 3)), 'hi': float(np.percentile(y, 97)), 'raw': t in ('Temperature', 'Tint')}
    # your look: the edit closest to your typical sliders, with crops and local masks taken out
    keys = [t for t in ('Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012', 'Vibrance', 'Saturation', 'Clarity2012', 'Texture', 'Dehaze') if any(t in r['m'] for r in rows)]
    if keys:
        M = np.array([[float(r['m'].get(k, 0) or 0) for k in keys] for r in rows])
        med = np.median(M, 0)
        best = rows[int(np.argmin(((M - med) ** 2).sum(1)))]
        look = os.path.join(LEARN, 'look-%s-%s.xmp' % (biz, job))
        args = [exiftool_bin(), '-o', look, '-tagsfromfile', best['src'], '-XMP-crs:all']
        try:
            if os.path.exists(look):
                os.unlink(look)
            subprocess.run(args + [best['src']], capture_output=True, timeout=60)
            subprocess.run([exiftool_bin(), '-overwrite_original'] + ['-XMP-crs:%s=' % t for t in LOCAL_TAGS] + [look], capture_output=True, timeout=60)
            model['look'] = os.path.basename(look)
        except Exception as ex:
            log('look', ex)
    write_json(os.path.join(LEARN, 'edit-%s-%s.json' % (biz, job)), model)
    return {'ok': True, 'n': len(rows), 'sliders': sorted(model['t'].keys()), 'look': bool(model.get('look'))}


def edit_model(biz, job):
    m = read_json(os.path.join(LEARN, 'edit-%s-%s.json' % (biz, job)))
    if not m:
        m = read_json(os.path.join(LEARN, 'edit-%s-all.json' % biz))
    return m


def stats():
    out = {'picks': {}, 'edits': {}, 'history': (read_json(os.path.join(LEARN, 'history.json'), []) or [])[-30:]}
    for f in glob.glob(os.path.join(LEARN, 'picks-*.json')):
        m = read_json(f) or {}
        out['picks'][m.get('job', '?')] = {'n': m.get('n'), 'pos': m.get('pos'), 'alpha': m.get('alpha'), 'shoots': m.get('shoots'), 'updated': m.get('updated')}
    for f in glob.glob(os.path.join(LEARN, 'edit-*.json')):
        m = read_json(f) or {}
        out['edits']['%s-%s' % (m.get('biz'), m.get('job'))] = {'n': m.get('n'), 'sliders': sorted((m.get('t') or {}).keys()), 'look': bool(m.get('look')), 'updated': m.get('updated')}
    return out
