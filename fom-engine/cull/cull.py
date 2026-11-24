#!/usr/bin/env python3
"""FOM Cull command line. The FOM Engine runs these for the dashboard; you can run them too.

  cull.py run     --folder F --biz fom|sba --job events|portraits|cars|sport --strict tight|normal|loose [--no-claude] [--fresh]
  cull.py decide  --folder F [--job J] [--strict S] [--priority p1,p3] [--claude]
  cull.py write   --folder F --edit none|basic|preset|learned [--preset "My preset.xmp"]
  cull.py reset   --folder F
  cull.py learn   --folder F --finals EXPORTS        learn from your final picks (and edits, if exported with settings)
  cull.py learn-edits --folder PAST --biz B --job J  learn your editing from a past shoot exported as Original + Settings
  cull.py stats | caps | presets --biz B | selftest
"""
import argparse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_state, save_state, cache_dir, progress, log, shoot_id, clean_old_caches, JOBS


def done(obj):
    sys.stdout.write(json.dumps(dict(obj, done=True)) + '\n')
    sys.stdout.flush()


def face_chips(st):
    from PIL import Image
    cdir = cache_dir(st['folder'])
    for person in st.get('people') or []:
        out = os.path.join(cdir, 'faces', person['id'] + '.jpg')
        try:
            im = Image.open(os.path.join(cdir, 'prev', person['face']['photo'] + '.jpg'))
            x, y, w, h = person['face']['b']
            W, H = im.size
            cx, cy, s = (x + w / 2) * W, (y + h / 2) * H, max(w * W, h * H) * 1.6
            im.crop((int(max(0, cx - s / 2)), int(max(0, cy - s / 2)), int(min(W, cx + s / 2)), int(min(H, cy + s / 2)))).resize((160, 160)).save(out, 'JPEG', quality=85)
        except Exception as ex:
            log('chip', person['id'], ex)


def priority_faces(st):
    cdir = cache_dir(st['folder'])
    return [os.path.join(cdir, 'faces', p + '.jpg') for p in (st.get('priority') or []) if os.path.exists(os.path.join(cdir, 'faces', p + '.jpg'))]


def cmd_run(a):
    from scan import scan
    from analyze import analyze, capabilities
    from decide import decide
    folder = os.path.realpath(a.folder)
    clean_old_caches()
    t0 = time.time()
    old = load_state(folder) if not a.fresh else None
    photos = scan(folder)
    have = {p['id']: p for p in (old or {}).get('photos', []) if 'a' in p}
    new = [p for p in photos if not (p['id'] in have and have[p['id']].get('main') == p['main'])]
    for p in photos:
        if p['id'] in have and p not in new:
            p['a'] = have[p['id']]['a']
    if new:
        analyze(folder, new)
        if len(new) < len(photos):     # CLIP needs every photo in the same file
            from analyze import _clip_and_beauty, M_AES
            import numpy as np
            good = [p for p in photos if 'a' in p]
            emb, aes = _clip_and_beauty([p['id'] for p in good], [os.path.join(cache_dir(folder), 'prev', p['id'] + '.jpg') for p in good])
            if emb is not None:
                np.save(os.path.join(cache_dir(folder), 'clip.npy'), emb)
                open(os.path.join(cache_dir(folder), 'clip_ids.txt'), 'w').write('\n'.join(p['id'] for p in good))
            if aes is not None:
                for p, v in zip(good, aes):
                    p['a']['aes'] = round(float(v), 3)
    st = {'v': 1, 'folder': folder, 'sid': shoot_id(folder), 'name': os.path.basename(folder), 'biz': a.biz, 'job': a.job,
          'strict': a.strict, 'created': (old or {}).get('created', time.time()), 'photos': photos,
          'priority': (old or {}).get('priority', []), 'overrides': (old or {}).get('overrides', {}),
          'written': (old or {}).get('written'), 'learned': (old or {}).get('learned'), 'finals': (old or {}).get('finals'),
          'caps': capabilities()}
    progress('decide', 0, 1, 'Grouping and choosing')
    decide(st)
    face_chips(st)
    if not a.no_claude:
        from claude_pick import ask
        res = ask(st, priority_faces(st))
        st['claudeMsg'] = res.get('msg', '')
        if res.get('ok') and st.get('claude'):
            decide(st)
    st['secs'] = round(time.time() - t0)
    save_state(folder, st)
    done({'counts': st['counts'], 'secs': st['secs'], 'photos': len(photos)})


def cmd_decide(a):
    from decide import decide
    folder = os.path.realpath(a.folder)
    st = load_state(folder)
    if not st:
        raise SystemExit('Cull this folder first.')
    if a.job:
        st['job'] = a.job
    if a.strict:
        st['strict'] = a.strict
    if a.priority is not None:
        st['priority'] = [x for x in a.priority.split(',') if x]
    if a.overrides:
        st['overrides'] = json.loads(open(a.overrides).read())
    decide(st)
    if a.claude:
        from claude_pick import ask
        res = ask(st, priority_faces(st))
        st['claudeMsg'] = res.get('msg', '')
        if res.get('ok'):
            decide(st)
    save_state(folder, st)
    done({'counts': st['counts']})


def cmd_write(a):
    from xmp import write_all
    done(write_all(os.path.realpath(a.folder), a.edit, a.preset))


def cmd_reset(a):
    from xmp import reset
    done(reset(os.path.realpath(a.folder)))


def cmd_learn(a):
    from learn import learn_picks
    done(learn_picks(os.path.realpath(a.folder), os.path.realpath(a.finals)))


def cmd_learn_edits(a):
    from learn import learn_edits
    done(learn_edits(os.path.realpath(a.folder), a.biz, a.job))


def cmd_stats(a):
    from learn import stats
    done(stats())


def cmd_caps(a):
    from analyze import capabilities
    from claude_pick import claude_bin
    c = capabilities()
    c['claude'] = bool(claude_bin())
    done(c)


def cmd_presets(a):
    from edits import list_presets
    done({'presets': list_presets(a.biz)})


def cmd_selftest(a):
    """Checks every model and tool on a made-up photo; setup.sh runs this."""
    import numpy as np, cv2, tempfile, subprocess
    from common import exiftool_bin
    from analyze import _init_worker, _one, _W, capabilities
    from claude_pick import claude_bin
    res = {}
    try:
        res['exiftool'] = subprocess.run([exiftool_bin(), '-ver'], capture_output=True, text=True).stdout.strip() or False
    except Exception:
        res['exiftool'] = False
    _init_worker()
    res['face finder'] = _W.get('yunet') is not None
    res['people'] = _W.get('sface') is not None
    res['eyes and smiles'] = _W.get('land') is not None
    res.update({'beauty and similar shots': capabilities()['clip'] and capabilities()['beauty']})
    res['claude'] = bool(claude_bin())
    d = tempfile.mkdtemp()
    img = np.full((1000, 1500, 3), 128, np.uint8)
    cv2.putText(img, 'FOM', (300, 600), cv2.FONT_HERSHEY_SIMPLEX, 12, (240, 240, 240), 30)
    p = os.path.join(d, 't.jpg')
    cv2.imwrite(p, img)
    _, r = _one(('t', p))
    res['analysis'] = r is not None
    try:
        import pillow_heif  # noqa
        res['heic'] = True
    except Exception:
        res['heic'] = False
    done(res)


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd')
    r = sp.add_parser('run'); r.add_argument('--folder', required=True); r.add_argument('--biz', default='fom'); r.add_argument('--job', default='events', choices=JOBS)
    r.add_argument('--strict', default='normal'); r.add_argument('--no-claude', action='store_true'); r.add_argument('--fresh', action='store_true')
    d = sp.add_parser('decide'); d.add_argument('--folder', required=True); d.add_argument('--job'); d.add_argument('--strict'); d.add_argument('--priority')
    d.add_argument('--overrides'); d.add_argument('--claude', action='store_true')
    w = sp.add_parser('write'); w.add_argument('--folder', required=True); w.add_argument('--edit', default='none'); w.add_argument('--preset')
    x = sp.add_parser('reset'); x.add_argument('--folder', required=True)
    l = sp.add_parser('learn'); l.add_argument('--folder', required=True); l.add_argument('--finals', required=True)
    le = sp.add_parser('learn-edits'); le.add_argument('--folder', required=True); le.add_argument('--biz', default='fom'); le.add_argument('--job', default='all')
    sp.add_parser('stats'); sp.add_parser('caps'); sp.add_parser('selftest')
    pr = sp.add_parser('presets'); pr.add_argument('--biz', default='fom')
    a = ap.parse_args()
    fn = {'run': cmd_run, 'decide': cmd_decide, 'write': cmd_write, 'reset': cmd_reset, 'learn': cmd_learn,
          'learn-edits': cmd_learn_edits, 'stats': cmd_stats, 'caps': cmd_caps, 'presets': cmd_presets, 'selftest': cmd_selftest}.get(a.cmd)
    if not fn:
        ap.print_help(); return
    try:
        fn(a)
    except SystemExit as ex:
        if ex.code not in (0, None):
            done({'error': str(ex.code)})
    except Exception as ex:
        import traceback
        traceback.print_exc()
        done({'error': '%s: %s' % (type(ex).__name__, ex)})


if __name__ == '__main__':
    main()
