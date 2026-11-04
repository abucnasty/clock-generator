#!/usr/bin/env python3
"""Rank the jobs a change slowed: for the jobs both runs have, old seconds, new seconds, added seconds and ratio, most added
first (top N, default 10), plus the summed seconds of each side over those shared jobs. Text only; nothing is written.

usage: slowed.py <before> <after> [-n N]   exit 1, naming the side, when a side has no jobs

Each side is a folder of job files (blast.sh run <out>) or a cache entry (<cache>/<key>/ or its jobs/); blast.sh resolves a
bare key before calling this. Files whose name starts with "_" (the job list) are not jobs. A job without a numeric
`seconds` (an error job, say) is left out of the table and the sums, and counted.
"""
import glob, json, os, sys

def load(d):
    if os.path.exists(os.path.join(d, 'MANIFEST.json')):
        d = os.path.join(d, 'jobs')
    out = {}
    for f in glob.glob(os.path.join(d, '*.json')):
        if os.path.basename(f).startswith('_'):
            continue
        j = json.load(open(f))
        out[f"{j['group']}:{j['name']}"] = j
    return out

def seconds(j):
    s = j.get('seconds')
    return s if isinstance(s, (int, float)) and not isinstance(s, bool) else None

args, n = [], 10
it = iter(sys.argv[1:])
for a in it:
    if a == '-n':
        n = next(it, '')
    else:
        args.append(a)
if len(args) != 2 or not str(n).isdigit() or int(n) < 1:
    sys.exit("usage: slowed.py <before> <after> [-n N]")
n = int(n)
before, after = load(args[0]), load(args[1])
empty = [f"{name} ({path})" for name, path, side in (('before', args[0], before), ('after', args[1], after)) if not side]
if empty:
    sys.exit(f"slowed.py: no jobs in the {' or the '.join(empty)}: not a folder of job files or a cache entry")

rows, unmeasured = [], 0
for key in sorted(set(before) & set(after)):
    old, new = seconds(before[key]), seconds(after[key])
    if old is None or new is None:
        unmeasured += 1
        continue
    rows.append((key, old, new, new - old))
rows.sort(key=lambda r: (-r[3], r[0]))
old_sum, new_sum = sum(r[1] for r in rows), sum(r[2] for r in rows)

def ratio(old, new):
    return f"{new / old:.2f}x" if old > 0 else '-'

print(f"slowed: before {os.path.normpath(args[0])} -> after {os.path.normpath(args[1])}")
print(f"{len(rows)} jobs in both (before has {len(before)}, after has {len(after)}); sums are over those {len(rows)} shared jobs"
      + (f"; {unmeasured} shared without numeric seconds left out" if unmeasured else ''))
print(f"top {min(n, len(rows))} by added seconds\n")
width = max([len('job')] + [len(r[0]) for r in rows[:n]])
print(f"{'job':<{width}}  {'old s':>9}  {'new s':>9}  {'added s':>9}  {'ratio':>7}")
for key, old, new, added in rows[:n]:
    print(f"{key:<{width}}  {old:>9.3f}  {new:>9.3f}  {added:>+9.3f}  {ratio(old, new):>7}")
print(f"\nsum over {len(rows)} shared jobs: old {old_sum:.3f} s, new {new_sum:.3f} s, added {new_sum - old_sum:+.3f} s, ratio {ratio(old_sum, new_sum)}")
