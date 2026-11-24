"""Turn the measurements into a cull: groups of similar shots, a score for every photo,
keepers, highlights, duplicates, check me and rejects. Runs in under a second, so the page
can re-run it when you change how strict it is or tap a priority person.

Categories (what gets written for Lightroom, see xmp.py)
  hl     highlight   pick flag, 5 stars
  keep   keeper      pick flag, 3 stars
  dup    duplicate   1 star, Yellow
  check  check me    2 stars, Red
  rej    reject      reject flag, 0 stars
"""
import math
import numpy as np

from analyze import load_clip
from learn import learned_model, features as learn_features

KEEP_RATE = {'tight': 0.20, 'normal': 0.35, 'loose': 0.50}

# how much each thing counts, per job type (same rules for FOM Studios and Shot by A)
WEIGHTS = {
    'events':    {'sharp': .24, 'beauty': .22, 'eyes': .20, 'smile': .14, 'expo': .06, 'face': .04, 'look': .04, 'prio': .06},
    'portraits': {'sharp': .24, 'beauty': .18, 'eyes': .28, 'smile': .12, 'expo': .06, 'face': .02, 'look': .06, 'prio': .04},
    'cars':      {'sharp': .40, 'beauty': .36, 'eyes': .00, 'smile': .00, 'expo': .12, 'face': .00, 'look': .00, 'level': .12},
    'sport':     {'sharp': .44, 'beauty': .26, 'eyes': .06, 'smile': .00, 'expo': .10, 'face': .10, 'look': .04},
}
# a new group starts when shots are this many seconds apart
GAP = {'events': 8, 'portraits': 10, 'cars': 6, 'sport': 3}
CAT_ORDER = ['hl', 'keep', 'check', 'dup', 'rej']


def _rank(vals):
    """Percentile rank 0..1 inside this shoot, so a dark venue is judged against itself."""
    a = np.array(vals, dtype=float)
    if len(a) < 2:
        return np.ones_like(a)
    o = a.argsort().argsort()
    return o / (len(a) - 1)


def _hamming(a, b):
    try:
        return bin(int(a, 16) ^ int(b, 16)).count('1')
    except Exception:
        return 64


def _hist_sim(a, b):
    a, b = np.array(a), np.array(b)
    return float(np.minimum(a, b).sum())


def similar(p, q, clip):
    """0..1 how alike two shots are."""
    ea, eb = clip.get(p['id']), clip.get(q['id'])
    if ea is not None and eb is not None:
        return float(np.dot(ea, eb))
    h = _hamming(p['a'].get('ph', ''), q['a'].get('ph', ''))
    return 0.5 * (1 - h / 32.0) + 0.5 * _hist_sim(p['a']['hist'], q['a']['hist'])


def sim_threshold(clip):
    return 0.88 if clip else 0.70


def main_faces(a):
    fs = a.get('faces') or []
    if not fs:
        return []
    big = max(f['b'][2] for f in fs)
    return [f for f in fs if f['b'][2] >= max(0.025, big * 0.55)]


def cluster_people(photos, min_count=3):
    """Group faces into people with the SFace embeddings. Returns the people list and sets f['pid']."""
    cents, members = [], []
    for p in photos:
        for fi, f in enumerate(p['a'].get('faces') or []):
            e = f.get('e')
            if e is None or f['b'][2] < 0.03:
                continue
            v = np.array(e)
            best, bi = 0.0, -1
            for k, c in enumerate(cents):
                s = float(np.dot(v, c / (np.linalg.norm(c) or 1)))
                if s > best:
                    best, bi = s, k
            if best >= 0.42:
                cents[bi] = cents[bi] + v
                members[bi].append((p['id'], fi, f))
            else:
                cents.append(v.copy())
                members.append([(p['id'], fi, f)])
    order = sorted(range(len(members)), key=lambda k: -len(set(m[0] for m in members[k])))
    people = []
    for rank, k in enumerate(order):
        photos_in = sorted(set(m[0] for m in members[k]))
        if len(photos_in) < min_count:
            for _, _, f in members[k]:
                f.pop('pid', None)
            continue
        pid = 'p%d' % (len(people) + 1)
        for _, _, f in members[k]:
            f['pid'] = pid
        # the clearest face for the chip: big, sharp, eyes open
        best = max(members[k], key=lambda m: m[2]['b'][2] * (1 + m[2].get('eo', 0.5)) * (1 + m[2].get('sh', 0) / 10))
        people.append({'id': pid, 'n': len(photos_in), 'face': {'photo': best[0], 'b': best[2]['b']}})
    return people


def score_all(photos, job, priority, model):
    W = WEIGHTS.get(job, WEIGHTS['events'])
    sharp_raw = []
    for p in photos:
        a = p['a']
        mf = main_faces(a)
        s = max([f.get('sh', 0) for f in mf]) if mf else a['st']
        sharp_raw.append(0.6 * s + 0.4 * a['st'] if mf else a['st'])
    sharp = _rank(sharp_raw)
    beauty_raw = [p['a'].get('aes') for p in photos]
    has_beauty = any(b is not None for b in beauty_raw)
    beauty = _rank([b if b is not None else 0 for b in beauty_raw]) if has_beauty else None
    med_sharp = float(np.median(sharp_raw)) if sharp_raw else 0
    for i, p in enumerate(photos):
        a = p['a']
        mf = main_faces(a)
        ex = a['ex']
        eo = [f.get('eo') for f in mf if f.get('eo') is not None]
        eyes = min(eo) if eo else (0.6 if mf else 0.5)
        smile = float(np.mean([f.get('smile', 0) for f in mf])) if mf else 0.0
        look = float(np.mean([1 - min(1, abs(f.get('yaw', 0)) / 0.5) for f in mf])) if mf else 0.5
        mid = 1 - min(1, abs(ex['p50'] - 118) / 118.0)
        clip_pen = min(1, ex['hi'] * 8 + ex['lo'] * 4)
        expo = max(0, mid - clip_pen)
        level = 1.0
        if a.get('hz') and a['hz']['c'] > 0.4:
            level = 1 - min(1, abs(a['hz']['a']) / 4.0)
        prio_in = [f for f in (a.get('faces') or []) if f.get('pid') in priority]
        prio = 0.0
        if prio_in:
            prio = 0.5 + 0.5 * min(f.get('eo', 0.7) for f in prio_in)
        parts = {'sharp': float(sharp[i]), 'beauty': float(beauty[i]) if beauty is not None else float(sharp[i]),
                 'eyes': eyes, 'smile': min(1, smile * 1.4), 'expo': expo, 'face': 1.0 if mf else 0.0,
                 'look': look, 'prio': prio, 'level': level}
        q = sum(W.get(k, 0) * v for k, v in parts.items())
        if priority and prio_in:
            q += 0.10 + 0.08 * prio
        p['_parts'] = parts
        p['_sharp_raw'] = sharp_raw[i]
        p['_q0'] = q
    if model:
        alpha = model['alpha']
        for p in photos:
            x = learn_features(p, job)
            z = float(np.dot(model['w'], x) + model['b'])
            prob = 1 / (1 + math.exp(-max(-30, min(30, z))))
            p['_q0'] = (1 - alpha) * p['_q0'] + alpha * prob
    return med_sharp


def make_groups(photos, job, clip):
    gap = GAP.get(job, 8)
    th = sim_threshold(clip)
    groups = []
    cur = []
    for p in photos:
        if cur:
            last, first = cur[-1], cur[0]
            dt = (p.get('t') or 0) - (last.get('t') or 0)
            close = 0 <= dt <= gap if (p.get('t') and last.get('t')) else True
            alike = max(similar(p, last, clip), similar(p, first, clip) - 0.03) >= th
            if close and alike and len(cur) < 60:
                cur.append(p)
                continue
            groups.append(cur)
        cur = [p]
    if cur:
        groups.append(cur)
    for gi, g in enumerate(groups):
        for p in g:
            p['_g'] = gi
    return groups


def hard_fails(p, med_sharp, job):
    """Reasons a shot is a reject or needs a look, before comparing it with its group."""
    a = p['a']
    ex = a['ex']
    why_rej, why_chk = [], []
    if ex['mean'] < 10 or ex['mean'] > 248 or (ex['p99'] - ex['p01']) < 18:
        why_rej.append('misfire')
    if why_rej:
        return why_rej, why_chk
    s = p['_sharp_raw']
    if s < med_sharp - 1.3:
        why_rej.append('blurry')
    elif s < med_sharp - 0.75:
        why_chk.append('soft focus')
    mf = main_faces(a)
    closed = [f for f in mf if f.get('eo') is not None and f['eo'] < 0.35]
    if closed:
        p['_blink'] = len(closed)
        p['_blink_all'] = len(closed) == len(mf)
    if ex['hi'] > 0.22:
        why_chk.append('bright')
    if ex['mean'] < 28 and ex['p95'] < 90:
        why_chk.append('dark')
    return why_rej, why_chk


def decide(st, clip=None):
    photos = [p for p in st['photos'] if 'a' in p]
    job = st.get('job', 'events')
    strict = st.get('strict', 'normal')
    priority = set(st.get('priority') or [])
    if clip is None:
        clip = load_clip(st['folder'])
    if 'people' not in st:
        st['people'] = cluster_people(photos)
    model = learned_model(job)
    st['learnUsed'] = {'n': model['n'], 'alpha': round(model['alpha'], 2)} if model else None
    med = score_all(photos, job, priority, model)
    groups = make_groups(photos, job, clip)
    claude = st.get('claude') or {}
    cg = claude.get('groups') or {}

    for p in photos:
        r, c = hard_fails(p, med, job)
        p['_rej'], p['_chk'] = r, c

    for gi, g in enumerate(groups):
        alive = [p for p in g if not p['_rej']]
        # blinks lose to any open-eyed alternative in the same group
        def key(p):
            q = p['_q0']
            if p.get('_blink'):
                q -= 0.25 if p.get('_blink_all') else 0.12
            if p['_chk']:
                q -= 0.08
            return q
        alive.sort(key=key, reverse=True)
        pick = cg.get(str(gi))
        if pick:
            alive.sort(key=lambda p: 0 if p['id'] == pick else 1)
        n = len(g)
        k = 1
        if job == 'sport':
            k = min(3, max(1, math.ceil(n / 5)))
        elif n >= 8:
            k = 2
        keepers = []
        for p in alive:
            if len(keepers) >= k:
                break
            if keepers and max(similar(p, x, clip) for x in keepers) > (0.95 if clip else 0.85):
                continue
            keepers.append(p)
        for rank, p in enumerate(alive):
            p['_gr'] = rank
        for p in g:
            why = list(p['_rej']) + list(p['_chk'])
            if p['_rej']:
                cat = 'rej'
            elif p in keepers:
                if p.get('_blink') and p.get('_blink_all') and len(alive) > 1 and any(not x.get('_blink') for x in alive):
                    cat = 'dup'
                elif p.get('_blink'):
                    cat = 'check'; why.append('eyes closed' if p.get('_blink_all') else 'someone blinked')
                elif p['_chk']:
                    cat = 'check'
                else:
                    cat = 'keep'
            else:
                if p.get('_blink'):
                    cat = 'rej' if p.get('_blink_all') else 'dup'
                    why.append('eyes closed' if p.get('_blink_all') else 'someone blinked')
                else:
                    cat = 'dup'
                if cat == 'dup' and 'similar' not in why and n > 1:
                    why.append('similar')
            p['_cat'] = cat
            p['_why'] = why

    # hit the keep rate: demote the weakest keepers, or promote distinct runners-up
    target = max(1, round(len(photos) * KEEP_RATE.get(strict, 0.35)))
    keep = sorted([p for p in photos if p['_cat'] == 'keep'], key=lambda p: p['_q0'])
    if len(keep) > target:
        for p in keep[:len(keep) - target]:
            p['_cat'] = 'dup' if len(groups[p['_g']]) > 1 else 'check'
            p['_why'].append('lower score')
    elif len(keep) < target:
        spare = sorted([p for p in photos if p['_cat'] == 'dup' and not p.get('_blink') and not p['_chk']], key=lambda p: -p['_q0'])
        for p in spare:
            if len(keep) >= target:
                break
            ks = [x for x in groups[p['_g']] if x['_cat'] == 'keep']
            if ks and max(similar(p, x, clip) for x in ks) > (0.96 if clip else 0.88):
                continue
            p['_cat'] = 'keep'
            p['_why'] = [w for w in p['_why'] if w != 'similar'] + ['adds variety']
            keep.append(p)

    # highlights: the best 5 to 10 percent of keepers, one per group, Claude's choice when it gave one
    keep = [p for p in photos if p['_cat'] == 'keep']
    n_hl = max(1, min(40, round(len(keep) * 0.08))) if keep else 0
    chosen = []
    hl_claude = [i for i in (claude.get('hl') or []) if any(p['id'] == i and p['_cat'] == 'keep' for p in photos)]
    used = set()
    for i in hl_claude:
        p = next(p for p in photos if p['id'] == i)
        if p['_g'] not in used and len(chosen) < n_hl:
            chosen.append(p); used.add(p['_g'])
    for p in sorted(keep, key=lambda p: -(p['_q0'] + 0.15 * p['_parts']['beauty'] + 0.1 * p['_parts']['prio'])):
        if len(chosen) >= n_hl:
            break
        if p['_g'] in used or p in chosen:
            continue
        chosen.append(p); used.add(p['_g'])
    for p in chosen:
        p['_cat'] = 'hl'

    # people with no keeper: offer their best shot
    missing = []
    for person in st.get('people') or []:
        ins = [p for p in photos if any(f.get('pid') == person['id'] for f in (p['a'].get('faces') or []))]
        if ins and not any(p['_cat'] in ('keep', 'hl') for p in ins):
            best = max(ins, key=lambda p: p['_q0'] if p['_cat'] != 'rej' else -1)
            missing.append({'person': person['id'], 'photo': best['id']})
    st['missing'] = missing

    # hand changes always win
    ov = st.get('overrides') or {}
    for p in photos:
        mf = main_faces(p['a'])
        p['d'] = {'c': p['_cat'], 'why': p['_why'], 'q': round(p['_q0'], 4), 'g': p['_g'], 'gr': p.get('_gr', 0),
                  'pt': {k: round(v, 3) for k, v in p['_parts'].items()}, 'bl': 1 if p.get('_blink') else 0, 'soft': 1 if p['_chk'] else 0,
                  'faces': len(mf), 'people': sorted(set(f['pid'] for f in (p['a'].get('faces') or []) if f.get('pid')))}
        if p['id'] in ov:
            p['d']['hand'] = ov[p['id']]
        for k in [k for k in p if k.startswith('_')]:
            del p[k]
    st['groups'] = [[p['id'] for p in g] for g in groups]
    counts = {c: 0 for c in CAT_ORDER}
    for p in photos:
        counts[final_cat(p)] += 1
    st['counts'] = counts
    st['target'] = target
    return st


def final_cat(p):
    h = (p.get('d') or {}).get('hand') or {}
    return h.get('c') or (p.get('d') or {}).get('c', 'check')
