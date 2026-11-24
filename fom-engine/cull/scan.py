"""Find the photos in a shoot folder, pair RAW + JPEG, read EXIF and make previews.

Previews come from the JPEG every RAW file already carries inside it (exiftool pulls it out
in a fraction of a second), so nothing is fully decoded. JPEG and HEIC are opened directly.
"""
import os, re, json, subprocess, tempfile, datetime
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps

from common import RAW_EXT, JPG_EXT, HEIC_EXT, IMG_EXT, exiftool_bin, cache_dir, progress, log

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF = True
except Exception:
    HEIF = False

PREV = 1600   # long edge of the analysis / loupe preview
THUMB = 420   # long edge of the grid thumbnail


def photo_id(rel):
    stem = os.path.splitext(rel)[0]
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', stem.replace(os.sep, '__'))


def list_files(folder):
    out = []
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('Selects',)]
        for f in files:
            if f.startswith('.') or f.startswith('._'):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in IMG_EXT:
                out.append(os.path.relpath(os.path.join(root, f), folder))
    out.sort()
    return out


def group_pairs(rels):
    """IMG_1234.CR3 + IMG_1234.JPG become one photo. The RAW is the main file."""
    by = {}
    for r in rels:
        by.setdefault(photo_id(r), []).append(r)
    photos = []
    for pid, files in by.items():
        raws = [f for f in files if os.path.splitext(f)[1].lower() in RAW_EXT]
        others = [f for f in files if f not in raws]
        main = (raws or others)[0]
        ext = os.path.splitext(main)[1].lower()
        kind = 'raw' if ext in RAW_EXT and ext != '.dng' else 'dng' if ext == '.dng' else 'heic' if ext in HEIC_EXT else 'jpg'
        photos.append({'id': pid, 'main': main, 'files': sorted(files), 'kind': kind, 'pair': bool(raws and others)})
    return photos


def _exif_time(e):
    for k in ('SubSecDateTimeOriginal', 'DateTimeOriginal', 'CreateDate', 'FileModifyDate'):
        v = e.get(k)
        if not v:
            continue
        v = str(v)
        m = re.match(r'(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)(\.\d+)?', v)
        if m:
            dt = datetime.datetime(*[int(x) for x in m.groups()[:6]])
            frac = float(m.group(7)) if m.group(7) else 0.0
            if k == 'DateTimeOriginal' and e.get('SubSecTimeOriginal') not in (None, ''):
                try:
                    frac = float('0.' + str(e['SubSecTimeOriginal']).strip())
                except Exception:
                    pass
            return dt.timestamp() + frac
    return 0.0


def read_exif(folder, photos):
    """One exiftool run for the whole shoot."""
    files = [os.path.join(folder, f) for p in photos for f in p['files']]
    if not files:
        return
    tags = ['-DateTimeOriginal', '-SubSecTimeOriginal', '-SubSecDateTimeOriginal', '-CreateDate', '-FileModifyDate',
            '-Orientation', '-ImageWidth', '-ImageHeight', '-ISO', '-ExposureTime', '-FNumber', '-FocalLength',
            '-ColorTempAsShot', '-Make', '-Model', '-LensModel', '-XMP-crs:ProcessVersion']
    with tempfile.NamedTemporaryFile('w', suffix='.args', delete=False) as af:
        af.write('\n'.join(files))
        argfile = af.name
    try:
        r = subprocess.run([exiftool_bin(), '-j', '-n', '-fast', '-charset', 'filename=utf8'] + tags + ['-@', argfile],
                           capture_output=True, text=True, timeout=1800)
        data = json.loads(r.stdout or '[]')
    except Exception as ex:
        log('exif read failed', ex)
        data = []
    finally:
        os.unlink(argfile)
    by = {os.path.realpath(d.get('SourceFile', '')): d for d in data}
    for p in photos:
        e = by.get(os.path.realpath(os.path.join(folder, p['main'])), {})
        for f in p['files']:   # a RAW + JPEG pair: fill gaps from the JPEG
            o = by.get(os.path.realpath(os.path.join(folder, f)), {})
            for k, v in o.items():
                if k not in e or (k == 'DateTimeOriginal' and not e.get(k)):
                    e[k] = v
        p['t'] = _exif_time(e)
        p['orient'] = int(e.get('Orientation') or 1)
        p['iso'] = e.get('ISO') or 0
        p['shutter'] = e.get('ExposureTime') or 0
        p['fnum'] = e.get('FNumber') or 0
        p['focal'] = e.get('FocalLength') or 0
        p['camera'] = ' '.join(str(x) for x in (e.get('Make') or '', e.get('Model') or '')).strip()
        p['asTemp'] = e.get('ColorTempAsShot') or 0
        p['pv'] = e.get('ProcessVersion') or ''


def _extract_raw_previews(folder, photos, outdir):
    """Pull the largest embedded JPEG out of every RAW / DNG in one exiftool run per tag."""
    raws = [p for p in photos if p['kind'] in ('raw', 'dng')]
    if not raws:
        return
    os.makedirs(outdir, exist_ok=True)
    for tag in ('PreviewImage', 'JpgFromRaw', 'OtherImage', 'ThumbnailImage'):
        todo = [p for p in raws if not os.path.exists(os.path.join(outdir, p['id'] + '.jpg'))]
        if not todo:
            break
        with tempfile.NamedTemporaryFile('w', suffix='.args', delete=False) as af:
            for p in todo:
                af.write('-b\n-' + tag + '\n-W\n' + os.path.join(outdir, p['id'] + '.jpg') + '\n' + os.path.join(folder, p['main']) + '\n-execute\n')
            argfile = af.name
        try:
            subprocess.run([exiftool_bin(), '-charset', 'filename=utf8', '-@', argfile], capture_output=True, timeout=3600)
        except Exception as ex:
            log('preview extract', tag, ex)
        finally:
            os.unlink(argfile)
        # a tiny thumbnail is not good enough when a bigger one may exist under the next tag
        for p in todo:
            f = os.path.join(outdir, p['id'] + '.jpg')
            try:
                if os.path.exists(f) and tag != 'ThumbnailImage':
                    with Image.open(f) as im:
                        if max(im.size) < 1000:
                            os.unlink(f)
            except Exception:
                try:
                    os.unlink(f)
                except Exception:
                    pass


def _orient(im, o):
    T = Image.Transpose
    op = {2: T.FLIP_LEFT_RIGHT, 3: T.ROTATE_180, 4: T.FLIP_TOP_BOTTOM, 5: T.TRANSPOSE,
          6: T.ROTATE_270, 7: T.TRANSVERSE, 8: T.ROTATE_90}.get(o)
    return im.transpose(op) if op is not None else im


def _make_one(args):
    folder, p, rawdir, cdir = args
    prev = os.path.join(cdir, 'prev', p['id'] + '.jpg')
    thumb = os.path.join(cdir, 'thumb', p['id'] + '.jpg')
    if os.path.exists(prev) and os.path.exists(thumb):
        try:
            with Image.open(prev) as im:
                p['pw'], p['ph'] = im.size
            return p['id'], True
        except Exception:
            pass
    try:
        def opened(path):
            i = Image.open(path)
            if i.format == 'JPEG':
                i.draft('RGB', (PREV, PREV))   # fast decode at reduced size
            return i
        if p['kind'] in ('raw', 'dng'):
            src = os.path.join(rawdir, p['id'] + '.jpg')
            jp = [f for f in p['files'] if os.path.splitext(f)[1].lower() in JPG_EXT]
            if not os.path.exists(src) and jp:          # RAW + JPEG pair: use the camera JPEG
                im = ImageOps.exif_transpose(opened(os.path.join(folder, jp[0])))
            else:
                im = _orient(opened(src), p.get('orient', 1))
        else:
            im = ImageOps.exif_transpose(opened(os.path.join(folder, p['main'])))
        im = im.convert('RGB')
        im.thumbnail((PREV, PREV), Image.LANCZOS)
        im.save(prev, 'JPEG', quality=86)
        p['pw'], p['ph'] = im.size
        t = im.copy()
        t.thumbnail((THUMB, THUMB), Image.LANCZOS)
        t.save(thumb, 'JPEG', quality=80)
        return p['id'], True
    except Exception as ex:
        log('preview failed', p['main'], ex)
        return p['id'], False


def make_previews(folder, photos):
    cdir = cache_dir(folder)
    rawdir = os.path.join(cdir, 'raw')
    progress('previews', 0, len(photos), 'Pulling previews out of the RAW files')
    _extract_raw_previews(folder, photos, rawdir)
    done = 0
    ok = set()
    with ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) - 1)) as ex:
        for pid, good in ex.map(_make_one, [(folder, p, rawdir, cdir) for p in photos]):
            done += 1
            if good:
                ok.add(pid)
            if done % 20 == 0 or done == len(photos):
                progress('previews', done, len(photos), 'Making previews')
    # the extracted full RAW previews are no longer needed
    import shutil
    shutil.rmtree(rawdir, ignore_errors=True)
    return [p for p in photos if p['id'] in ok]


def scan(folder):
    rels = list_files(folder)
    photos = group_pairs(rels)
    progress('scan', len(photos), len(photos), 'Found %d photos (%d files)' % (len(photos), len(rels)))
    read_exif(folder, photos)
    photos.sort(key=lambda p: (p.get('t') or 0, p['main']))
    photos = make_previews(folder, photos)
    return photos
