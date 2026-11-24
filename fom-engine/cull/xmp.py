"""Write the cull (and starter edits) where Lightroom (cloud) reads it, and undo it.

  CR3 and other RAW    XMP sidecar next to the file (IMG_1234.xmp). The RAW is never touched.
  JPEG, HEIC, DNG      XMP inside the file (Lightroom ignores sidecars for these). Only the
                       metadata block changes, never the pixels. Before the first write the old
                       metadata block is saved in .fomcull/backup/, so Reset puts it back exactly.
  RAW + JPEG pairs     both files get the same rating, flag, label and keywords.
"""
import os, shutil, subprocess, time

from common import RAW_EXT, JPG_EXT, HEIC_EXT, exiftool_bin, state_dir, progress, log, load_state, save_state
from decide import final_cat
import edits as E

# category -> (stars, label, pick)   pick: 1 pick flag, -1 reject flag, 0 no flag
SCHEME = {'hl': (5, '', 1), 'keep': (3, '', 1), 'dup': (1, 'Yellow', 0), 'check': (2, 'Red', 0), 'rej': (0, '', -1)}
WORD = {'hl': 'highlight', 'keep': 'keeper', 'dup': 'dup', 'check': 'check', 'rej': 'reject'}
SKELETON = ('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
            ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n  <rdf:Description rdf:about=""/>\n'
            ' </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>\n')


class ExifTool:
    """One exiftool process for the whole run (much faster than one per photo)."""
    def __init__(self):
        self.p = subprocess.Popen([exiftool_bin(), '-stay_open', 'True', '-@', '-'], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.n = 0

    def run(self, args):
        self.n += 1
        tag = '{ready%d}' % self.n
        self.p.stdin.write('\n'.join(args) + '\n-charset\nfilename=utf8\n-execute%d\n' % self.n)
        self.p.stdin.flush()
        out = []
        while True:
            line = self.p.stdout.readline()
            if not line or line.strip() == tag:
                break
            out.append(line.rstrip())
        return '\n'.join(out)

    def close(self):
        try:
            self.p.stdin.write('-stay_open\nFalse\n')
            self.p.stdin.flush()
            self.p.wait(timeout=20)
        except Exception:
            self.p.kill()


def targets(folder, p):
    """[(path to write, 'sidecar'|'embed', relative white balance?)] for one photo."""
    out = []
    for f in p['files']:
        ext = os.path.splitext(f)[1].lower()
        full = os.path.join(folder, f)
        if ext in RAW_EXT and ext != '.dng':
            out.append((os.path.splitext(full)[0] + '.xmp', 'sidecar', False))
        elif ext == '.dng':
            out.append((full, 'embed', False))
        else:
            out.append((full, 'embed', True))
    return out


def label_args(cat, hand, old_kw):
    stars, label, pick = SCHEME[cat]
    if hand:
        if 'r' in hand:
            stars = int(hand['r'])
        if 'l' in hand:
            label = hand['l']
        if 'f' in hand:
            pick = int(hand['f'])
    a = ['-XMP-xmp:Rating=%d' % stars, '-XMP-xmp:Label=%s' % label]
    if pick == 1:
        a += ['-XMP-xmpDM:Pick=1', '-XMP-xmpDM:Good=true']
    elif pick == -1:
        a += ['-XMP-xmpDM:Pick=-1', '-XMP-xmpDM:Good=false']
    else:
        a += ['-XMP-xmpDM:Pick=0', '-XMP-xmpDM:Good=']
    for k in old_kw:
        a += ['-XMP-dc:Subject-=' + k, '-XMP-lr:HierarchicalSubject-=' + k.replace('cull:', 'FOM Cull|')]
    return a


def keywords(p, cat):
    d = p.get('d') or {}
    kw = ['cull:' + WORD[cat]]
    if d.get('hand'):
        kw.append('cull:by-hand')
    else:
        for w in d.get('why') or []:
            kw.append('cull:' + w.replace(' ', '-'))
    kw.append('cull:group-%d' % (d.get('g', 0) + 1))
    for pid in d.get('people') or []:
        kw.append('cull:person-' + pid)
    return kw


def existing_cull_keywords(folder, photos):
    """cull: keywords already in the files (from an earlier run), so a re-run replaces them cleanly."""
    import json, tempfile
    paths = [t[0] for p in photos for t in targets(folder, p) if os.path.exists(t[0])]
    if not paths:
        return {}
    with tempfile.NamedTemporaryFile('w', suffix='.args', delete=False) as af:
        af.write('\n'.join(paths)); argf = af.name
    try:
        r = subprocess.run([exiftool_bin(), '-j', '-XMP-dc:Subject', '-charset', 'filename=utf8', '-@', argf], capture_output=True, text=True, timeout=900)
        out = {}
        for d in json.loads(r.stdout or '[]'):
            s = d.get('Subject') or []
            s = s if isinstance(s, list) else [s]
            out[os.path.realpath(d['SourceFile'])] = [str(k) for k in s if str(k).startswith('cull:')]
        return out
    except Exception as ex:
        log('read keywords', ex)
        return {}
    finally:
        os.unlink(argf)


def write_all(folder, edit_mode='none', preset=None):
    st = load_state(folder)
    if not st:
        raise SystemExit('Cull this folder first.')
    biz, job = st.get('biz', 'fom'), st.get('job', 'events')
    bdir = os.path.join(state_dir(folder), 'backup')
    os.makedirs(bdir, exist_ok=True)
    w = st.get('written') or {'files': {}}
    w.setdefault('files', {})
    preset_file, preset_vals, model = None, None, None
    if edit_mode == 'preset' and preset:
        preset_file = os.path.join(E.PRESETS, biz, os.path.basename(preset))
        preset_vals = E.read_preset(preset_file) if os.path.exists(preset_file) else None
        if not preset_vals:
            raise SystemExit('Preset not found: ' + preset)
    if edit_mode == 'learned':
        from learn import edit_model
        model = edit_model(biz, job)
        if not model:
            raise SystemExit('Nothing learned yet for %s %s. Use Learn from a past shoot first, or choose Basic.' % (biz, job))
    photos = [p for p in st['photos'] if 'd' in p]
    old_kw = existing_cull_keywords(folder, photos)
    et = ExifTool()
    errors = 0
    try:
        for i, p in enumerate(photos):
            cat = final_cat(p)
            hand = (p['d'].get('hand') or {})
            kw = keywords(p, cat)
            pl = None if cat == 'rej' else E.plan(edit_mode, p, job, biz, preset_file, preset_vals, model)
            for path, how, rel in targets(folder, p):
                key = os.path.relpath(path, folder)
                rec = w['files'].get(key)
                if rec is None:
                    rec = {'how': how}
                    if how == 'sidecar':
                        if os.path.exists(path):
                            b = os.path.join(bdir, key.replace(os.sep, '__'))
                            shutil.copy2(path, b)
                            rec['backup'] = os.path.basename(b)
                        else:
                            with open(path, 'w', encoding='utf-8') as f:
                                f.write(SKELETON)
                            rec['created'] = True
                    else:
                        b = os.path.join(bdir, key.replace(os.sep, '__') + '.xmp')
                        r = subprocess.run([exiftool_bin(), '-xmp', '-b', path], capture_output=True, timeout=60)
                        if r.stdout:
                            with open(b, 'wb') as f:
                                f.write(r.stdout)
                            rec['backup'] = os.path.basename(b)
                        else:
                            rec['none'] = True
                    w['files'][key] = rec
                gone = sorted(set(rec.get('kw') or []) | set(old_kw.get(os.path.realpath(path), [])))
                args = ['-overwrite_original', '-m'] + label_args(cat, hand, gone)
                args += ['-XMP-dc:Subject+=' + k for k in kw]
                args += ['-XMP-lr:HierarchicalSubject+=' + k.replace('cull:', 'FOM Cull|') for k in kw]
                if pl:
                    args += E.to_args(pl, rel)
                out = et.run(args + [path])
                if 'Error' in out and 'Warning' not in out:
                    errors += 1
                    log('write', key, out)
                rec['kw'] = kw
                rec['edit'] = edit_mode if pl else 'none'
            if (i + 1) % 10 == 0 or i + 1 == len(photos):
                progress('write', i + 1, len(photos), 'Writing for Lightroom')
                if (i + 1) % 100 == 0:
                    st['written'] = w
                    save_state(folder, st)
    finally:
        et.close()
    w.update({'t': time.time(), 'mode': edit_mode, 'preset': preset, 'errors': errors})
    st['written'] = w
    save_state(folder, st)
    return {'ok': True, 'files': len(w['files']), 'errors': errors}


def reset(folder):
    st = load_state(folder)
    if not st or not st.get('written'):
        return {'ok': True, 'files': 0}
    bdir = os.path.join(state_dir(folder), 'backup')
    files = st['written'].get('files') or {}
    n = 0
    for key, rec in files.items():
        path = os.path.join(folder, key)
        try:
            if rec.get('how') == 'sidecar':
                if rec.get('created'):
                    if os.path.exists(path):
                        os.unlink(path)
                elif rec.get('backup'):
                    shutil.copy2(os.path.join(bdir, rec['backup']), path)
            else:
                if rec.get('backup'):
                    subprocess.run([exiftool_bin(), '-overwrite_original', '-m', '-xmp<=' + os.path.join(bdir, rec['backup']), path], capture_output=True, timeout=60)
                elif rec.get('none'):
                    subprocess.run([exiftool_bin(), '-overwrite_original', '-m', '-xmp:all=', path], capture_output=True, timeout=60)
            n += 1
        except Exception as ex:
            log('reset', key, ex)
        if n % 50 == 0:
            progress('reset', n, len(files), 'Putting the files back')
    shutil.rmtree(bdir, ignore_errors=True)
    st['written'] = None
    save_state(folder, st)
    return {'ok': True, 'files': n}
