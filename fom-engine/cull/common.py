"""FOM Cull: shared paths, JSON helpers and progress reporting.

Layout
  ~/FOM Engine/                 the engine (this folder's parent)
    models/                     face, eye and CLIP models (setup.sh downloads them)
    cache/<shoot id>/           previews and thumbnails per shoot (auto cleaned after 14 days)
    learn/                      what the cull learned from your final picks and past edits
    presets/fom|sba/            Lightroom presets (.xmp) per business
  <shoot folder>/.fomcull/      state.json (the cull, your hand changes) and backup/ (metadata before writing)
"""
import hashlib, json, os, sys, time

ENGINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ENGINE, 'models')
CACHE = os.path.join(ENGINE, 'cache')
LEARN = os.path.join(ENGINE, 'learn')
PRESETS = os.path.join(ENGINE, 'presets')
for _d in (MODELS, CACHE, LEARN, PRESETS):
    os.makedirs(_d, exist_ok=True)

RAW_EXT = {'.cr3', '.cr2', '.nef', '.arw', '.raf', '.orf', '.rw2', '.dng'}
JPG_EXT = {'.jpg', '.jpeg'}
HEIC_EXT = {'.heic', '.heif', '.hif'}
IMG_EXT = RAW_EXT | JPG_EXT | HEIC_EXT | {'.png', '.tif', '.tiff'}

JOBS = ('events', 'portraits', 'cars', 'sport')


def exiftool_bin():
    for p in (os.environ.get('FOM_EXIFTOOL'), '/opt/homebrew/bin/exiftool', '/usr/local/bin/exiftool', '/tmp/exiftool/exiftool'):
        if p and os.path.exists(p):
            return p
    return 'exiftool'


def shoot_id(folder):
    return hashlib.sha1(os.path.realpath(folder).encode()).hexdigest()[:14]


def cache_dir(folder):
    d = os.path.join(CACHE, shoot_id(folder))
    os.makedirs(os.path.join(d, 'prev'), exist_ok=True)
    os.makedirs(os.path.join(d, 'thumb'), exist_ok=True)
    os.makedirs(os.path.join(d, 'faces'), exist_ok=True)
    return d


def state_dir(folder):
    d = os.path.join(folder, '.fomcull')
    os.makedirs(d, exist_ok=True)
    return d


def read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def load_state(folder):
    return read_json(os.path.join(state_dir(folder), 'state.json'), None)


def save_state(folder, st):
    st['savedAt'] = time.time()
    write_json(os.path.join(state_dir(folder), 'state.json'), st)


def progress(stage, done=0, total=0, msg=''):
    """One JSON line on stdout; the engine server forwards it to the page."""
    sys.stdout.write(json.dumps({'p': stage, 'd': done, 't': total, 'm': msg}) + '\n')
    sys.stdout.flush()


def log(*a):
    sys.stderr.write(' '.join(str(x) for x in a) + '\n')
    sys.stderr.flush()


def clean_old_caches(days=14):
    cut = time.time() - days * 86400
    for name in os.listdir(CACHE):
        p = os.path.join(CACHE, name)
        try:
            if os.path.isdir(p) and os.path.getmtime(p) < cut:
                import shutil
                shutil.rmtree(p, ignore_errors=True)
        except Exception:
            pass
