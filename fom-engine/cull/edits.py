"""Starter edits, written as Lightroom develop settings (crs:) next to the ratings.

Three modes, asked before every cull:
  basic    exposure, white balance, highlights and shadows, straighten (with a clean crop)
  preset   one of your Lightroom presets per job type, plus the same per-photo exposure and WB fix
  learned  your own look and slider habits, learned from past shoots (learn.py)
  none     ratings only
Values stay gentle on purpose: this is a head start, you finish in Lightroom.
"""
import math, os, subprocess, json

from common import PRESETS, LEARN, exiftool_bin, log

PV_DEFAULT = '15.4'       # Lightroom process version 6; replaced by the one in your own presets or edits
ANGLE_SIGN = 1.0          # flip to -1.0 if the first test shows straighten going the wrong way
TARGET_MID = {'events': 0.205, 'portraits': 0.21, 'cars': 0.18, 'sport': 0.185}


def _lin(v):
    v = v / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _fmt(v, nd=0):
    if nd:
        return ('%+.' + str(nd) + 'f') % v
    return '%+d' % int(round(v))


def basic(p, job):
    """Per-photo fixes from what the preview shows. Returns numbers (not strings)."""
    a = p['a']
    ex, wb = a['ex'], a['wb']
    out = {}
    mid = max(_lin(ex['p50']), 0.002)
    ev = math.log2(TARGET_MID.get(job, 0.2) / mid) * 0.75
    ev = max(-1.5, min(1.5, ev))
    if abs(ev) >= 0.1:
        out['Exposure2012'] = round(ev, 2)
    if ex['hi'] > 0.01:
        out['Highlights2012'] = -int(min(70, 15 + ex['hi'] * 500))
    if ex['p05'] < 18 and ex['lo'] > 0.01:
        out['Shadows2012'] = int(min(45, 10 + ex['lo'] * 300))
    # white balance: only when there is enough neutral grey to judge, and only part of the way
    if wb.get('cover', 0) >= 0.08:
        shift = (wb['bg'] - wb['rg']) / 2.0          # > 0 means too blue
        tint_shift = -(wb['rg'] + wb['bg']) / 2.0     # > 0 means too green
        if p['kind'] in ('raw', 'dng') and p.get('asTemp'):
            mired = 1e6 / p['asTemp'] - 110 * shift * 0.6
            temp = int(round(max(2500, min(12000, 1e6 / max(mired, 60))) / 50.0) * 50)
            if abs(temp - p['asTemp']) >= 150:
                out['WhiteBalance'] = 'Custom'
                out['Temperature'] = temp
                out['Tint'] = int(round(max(-40, min(40, 6 + tint_shift * 60))))
        elif p['kind'] in ('jpg', 'heic'):
            t = int(round(max(-25, min(25, shift * 60))))
            ti = int(round(max(-20, min(20, tint_shift * 50))))
            if abs(t) >= 3 or abs(ti) >= 3:
                out['Temperature'] = t
                out['Tint'] = ti
    hz = a.get('hz')
    if hz and hz['c'] >= 0.55 and 0.4 <= abs(hz['a']) <= 6 and job in ('events', 'cars', 'portraits'):
        ang = ANGLE_SIGN * hz['a']
        out.update(crop_for_angle(ang, p.get('pw') or 3, p.get('ph') or 2))
    return out


def crop_for_angle(angle, w, h):
    """Straighten and crop in to the biggest same-shape frame, so no corners show."""
    th = math.radians(abs(angle))
    c, s = math.cos(th), math.sin(th)
    k = min(w / (w * c + h * s), h / (w * s + h * c))
    m = (1 - k) / 2
    return {'CropAngle': round(angle, 2), 'CropTop': round(m, 6), 'CropLeft': round(m, 6), 'CropBottom': round(1 - m, 6),
            'CropRight': round(1 - m, 6), 'HasCrop': 'True'}


def read_preset(path):
    try:
        r = subprocess.run([exiftool_bin(), '-j', '-n', '-XMP-crs:all', path], capture_output=True, text=True, timeout=30)
        d = (json.loads(r.stdout or '[]') or [{}])[0]
        return d
    except Exception as ex:
        log('preset read', ex)
        return {}


def list_presets(biz):
    d = os.path.join(PRESETS, biz)
    os.makedirs(d, exist_ok=True)
    return sorted(f for f in os.listdir(d) if f.lower().endswith('.xmp'))


def plan(mode, p, job, biz, preset_file=None, preset_vals=None, model=None):
    """What to write for one photo: {'from': settings file to copy first or None, 'set': {tag: value}}"""
    if mode in (None, '', 'none'):
        return None
    if mode == 'basic':
        s = basic(p, job)
        s.setdefault('ProcessVersion', p.get('pv') or PV_DEFAULT)
        return {'from': None, 'set': s}
    if mode == 'preset' and preset_file:
        s = basic(p, job)
        pv = {}
        for k, v in (preset_vals or {}).items():
            try:
                pv[k] = float(v) if k in ('Exposure2012', 'Highlights2012', 'Shadows2012') else v
            except Exception:
                pv[k] = v
        for k in ('Exposure2012', 'Highlights2012', 'Shadows2012'):
            if k in s and isinstance(pv.get(k), (int, float)):
                s[k] = round(s[k] + pv[k], 2) if k == 'Exposure2012' else int(max(-100, min(100, s[k] + pv[k])))
        if pv.get('WhiteBalance') and pv.get('WhiteBalance') not in ('As Shot', 'Auto'):
            for k in ('WhiteBalance', 'Temperature', 'Tint'):   # the preset sets its own white balance
                s.pop(k, None)
        if not pv.get('ProcessVersion'):
            s['ProcessVersion'] = PV_DEFAULT
        return {'from': preset_file, 'set': s}
    if mode == 'learned' and model:
        from learn import edit_feats
        x = edit_feats(p['a'], p.get('asTemp') or 0, p.get('iso') or 0)
        s = {}
        raw = p['kind'] in ('raw', 'dng')
        for t, m in (model.get('t') or {}).items():
            if m.get('raw') and not raw:
                continue
            v = float(sum(a * b for a, b in zip(m['w'], x)))
            v = max(m['lo'], min(m['hi'], v))
            s[t] = round(v, 2) if t == 'Exposure2012' else int(round(v / 50.0) * 50) if t == 'Temperature' else int(round(v))
        if 'Temperature' in s:
            s['WhiteBalance'] = 'Custom'
        b = basic(p, job)
        for k in ('CropAngle', 'CropTop', 'CropLeft', 'CropBottom', 'CropRight', 'HasCrop'):
            if k in b:
                s[k] = b[k]
        look = os.path.join(LEARN, model['look']) if model.get('look') else None
        if not look:
            s.setdefault('ProcessVersion', PV_DEFAULT)
        return {'from': look if look and os.path.exists(look) else None, 'set': s}
    return None


def to_args(pl, relative_wb):
    """exiftool arguments for a plan. relative_wb: JPEG/HEIC use -100..100 temperature and tint."""
    if not pl:
        return []
    args = []
    if pl.get('from'):
        args += ['-tagsfromfile', pl['from'], '-XMP-crs:all']
    s = dict(pl['set'])
    s['HasSettings'] = 'True'
    for k, v in s.items():
        if k in ('Temperature', 'Tint') and relative_wb and isinstance(v, (int, float)):
            v = _fmt(v)
        elif k in ('Exposure2012',):
            v = _fmt(v, 2)
        elif isinstance(v, (int, float)) and k not in ('Temperature', 'CropAngle', 'CropTop', 'CropLeft', 'CropBottom', 'CropRight'):
            v = _fmt(v)
        args.append('-XMP-crs:%s=%s' % (k, v))
    return args
