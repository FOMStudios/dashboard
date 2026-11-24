"""Claude has the last word on the close calls, through Claude Code on your Pro plan (no API key).

It never sees the whole shoot. It gets a few contact sheets:
  close-NN.jpg   one group where the top shots scored almost the same, letters A to F
  hl-N.jpg       the strongest keepers, numbered, to choose the highlights
  person.jpg     the priority people, if you tapped any
That keeps a 900 photo job to one short request.
"""
import os, json, re, shutil, subprocess
from PIL import Image, ImageDraw, ImageFont

from common import cache_dir, progress, log

LETTERS = 'ABCDEF'
GUIDE = {
    'events': 'real moments and emotion, everyone\'s eyes open, faces clear and sharp, the main people (birthday person, couple, speaker) favoured, nobody caught mid-blink or mid-chew',
    'portraits': 'eyes open and sharp, natural expressions, flattering angles, everyone in a group looking good at the same time',
    'cars': 'the car sharp and clean, strong angles, straight lines, good light and reflections, panning shots where the car is sharp count as good',
    'sport': 'peak action, the athlete sharp, faces and intensity visible, the ball or key object in frame',
}


def claude_bin():
    for p in (shutil.which('claude'), os.path.expanduser('~/.claude/local/claude'), '/opt/homebrew/bin/claude',
              '/usr/local/bin/claude', os.path.expanduser('~/.local/bin/claude'), os.path.expanduser('~/.npm-global/bin/claude')):
        if p and os.path.exists(p):
            return p
    return None


def _font(sz):
    for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        try:
            return ImageFont.truetype(f, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def sheet(paths, labels, out, cols=3, cell=520, title=''):
    rows = (len(paths) + cols - 1) // cols
    top = 56 if title else 0
    W, H = cols * cell, rows * cell + top
    im = Image.new('RGB', (W, H), (24, 24, 26))
    d = ImageDraw.Draw(im)
    f, ft = _font(40), _font(30)
    if title:
        d.text((16, 12), title, fill=(240, 240, 236), font=ft)
    for i, (p, lab) in enumerate(zip(paths, labels)):
        try:
            t = Image.open(p).convert('RGB')
            t.thumbnail((cell - 12, cell - 12))
        except Exception:
            continue
        x = (i % cols) * cell + (cell - t.width) // 2
        y = top + (i // cols) * cell + (cell - t.height) // 2
        im.paste(t, (x, y))
        d.rectangle([x, y, x + 64, y + 54], fill=(0, 0, 0))
        d.text((x + 12, y + 4), str(lab), fill=(255, 214, 10), font=f)
    im.save(out, 'JPEG', quality=84)


def ask(st, priority_faces=None, timeout=300):
    """Builds the sheets, asks Claude, stores st['claude'] = {'groups': {gi: id}, 'hl': [ids]}."""
    exe = claude_bin()
    if not exe:
        return {'ok': False, 'msg': 'Claude Code was not found, so the cull used its own scores.'}
    folder = st['folder']
    cdir = cache_dir(folder)
    sd = os.path.join(cdir, 'sheets')
    shutil.rmtree(sd, ignore_errors=True)
    os.makedirs(sd)
    photos = {p['id']: p for p in st['photos'] if 'd' in p}
    prev = lambda i: os.path.join(cdir, 'prev', i + '.jpg')
    # close calls
    close = []
    for gi, ids in enumerate(st.get('groups') or []):
        alive = sorted([photos[i] for i in ids if i in photos and photos[i]['d']['c'] != 'rej'], key=lambda p: -p['d']['q'])
        if len(alive) >= 2 and alive[0]['d']['q'] - alive[1]['d']['q'] < 0.035:
            close.append((gi, alive[:6]))
    close = sorted(close, key=lambda c: c[1][0]['d']['q'] - c[1][1]['d']['q'])[:14]
    files, maps = [], {}
    for gi, al in close:
        name = 'close-%02d.jpg' % (gi + 1)
        sheet([prev(p['id']) for p in al], LETTERS[:len(al)], os.path.join(sd, name), cols=3 if len(al) > 4 else 2, title='Group %d' % (gi + 1))
        maps[str(gi)] = {LETTERS[k]: p['id'] for k, p in enumerate(al)}
        files.append(name)
    # highlight candidates
    keep = sorted([p for p in photos.values() if p['d']['c'] in ('keep', 'hl')], key=lambda p: -p['d']['q'])
    n_hl = max(1, min(40, round(len(keep) * 0.08))) if keep else 0
    cand = keep[:min(36, max(12, n_hl * 3))]
    hl_files = []
    for s in range(0, len(cand), 12):
        name = 'hl-%d.jpg' % (s // 12 + 1)
        chunk = cand[s:s + 12]
        sheet([prev(p['id']) for p in chunk], [str(s + k + 1) for k in range(len(chunk))], os.path.join(sd, name), cols=4, cell=440)
        hl_files.append(name)
    if priority_faces:
        sheet(priority_faces, ['P%d' % (k + 1) for k in range(len(priority_faces))], os.path.join(sd, 'person.jpg'), cols=4, cell=260, title='Priority people')
    if not close and not cand:
        return {'ok': True, 'msg': 'Nothing for Claude to decide.'}
    job = st.get('job', 'events')
    kind = {'events': 'an event', 'portraits': 'a portrait', 'cars': 'a car', 'sport': 'a sport'}.get(job, 'an event')
    prompt = ('You are helping a professional photographer cull %s shoot. Judge like a picky wedding and event photographer: %s.\n' % (kind, GUIDE.get(job, GUIDE['events'])) +
              ('Read person.jpg first: those are the priority people. Prefer frames where they look their best.\n' if priority_faces else '') +
              ('Read each close-NN.jpg. Each is one burst of near-identical shots labelled with letters. Pick the single best letter.\n' if close else '') +
              ('Read %s. Those are numbered keepers. Pick the %d strongest as highlights (the ones the client would print or post first), at most one from any near-identical pair.\n' % (', '.join(hl_files), n_hl) if cand else '') +
              'Reply with JSON only, no other text, like {"close": {"close-03": "B"}, "highlights": [4, 11, 2]}.')
    progress('claude', 0, 1, 'Claude is choosing between close calls and highlights')
    try:
        r = subprocess.run([exe, '-p', prompt, '--allowedTools', 'Read', '--output-format', 'text'], cwd=sd,
                           capture_output=True, text=True, timeout=timeout)
        txt = r.stdout or ''
        m = re.search(r'\{.*\}', txt, re.S)
        ans = json.loads(m.group(0)) if m else {}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'msg': 'Claude took too long, so the cull used its own scores.'}
    except Exception as ex:
        log('claude', ex)
        return {'ok': False, 'msg': 'Claude could not answer (%s), so the cull used its own scores.' % ex}
    out = {'groups': {}, 'hl': []}
    for k, v in (ans.get('close') or {}).items():
        gi = str(int(re.sub(r'\D', '', k) or 0) - 1)
        pid = (maps.get(gi) or {}).get(str(v).strip().upper()[:1])
        if pid:
            out['groups'][gi] = pid
    for n in ans.get('highlights') or []:
        try:
            out['hl'].append(cand[int(n) - 1]['id'])
        except Exception:
            pass
    st['claude'] = out
    progress('claude', 1, 1, 'Claude chose %d close calls and %d highlights' % (len(out['groups']), len(out['hl'])))
    return {'ok': True, 'groups': len(out['groups']), 'hl': len(out['hl'])}
