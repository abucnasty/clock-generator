"""Counts of window cases (JSON lines on stdin from features.py) by the keys named, e.g.
    python3 features.py rec.json | python3 summarize.py recipe,taker_sink,taker_opened,F_L
Keys: any field of a case; taker_opened prints opened/before, pf_E craftE/nocraftE, m_status_L as is, recipe cut to 22
characters, F_L as F-L=<n>. Default: rec."""
import json, sys, collections
by = sys.argv[1].split(',') if len(sys.argv) > 1 else ['rec']
c = collections.Counter()
for l in sys.stdin:
    if not l.strip(): continue
    r = json.loads(l)
    key = tuple(
        ('opened' if r['taker_opened'] else 'before') if k == 'taker_opened' else
        ('craftE' if r['pf_E'] else 'nocraftE') if k == 'pf_E' else
        (r['recipe'] or '')[:22] if k == 'recipe' else
        'F-L=%s' % r['F_L'] if k == 'F_L' else
        str(r.get(k)) for k in by)
    c[key] += 1
for k, v in sorted(c.items()): print('%6d  %s' % (v, '  '.join(k)))
