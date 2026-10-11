#!/usr/bin/env python3
# scripts/clock-start-table.py <dir of clock-start-sample.js output> [-v]
# For each sample: whether its selected clock holds when it is started on a build that runs without a clock, and how
# many of its stable clocks do. -v lists every clock with what it ends in from each place. Simulator only.
import json, glob, os, sys
d = sys.argv[1]; verbose = '-v' in sys.argv
clocks = hold = errors = 0
generate = trials = 0.0
slowest = 0
groups = {'selected clock holds': [], 'selected clock fails': [], 'no stable clock': [], 'did not generate': []}
def word(c):
    if 'error' in c: return 'error: ' + c['error'][:60]
    if c['holds']: return f"holds, there within {c['back_after_periods']} periods"
    return 'fails from ' + ', '.join(f"{s['place']} (ends in {'/'.join(str(x) for x in s['ends_in'][:4])})" for s in c['starts'] if not s['recovers']) + f" of {c['expected_per_bin']}"
for f in sorted(glob.glob(os.path.join(d, '*.json'))):
    r = json.load(open(f)); key = r['key']
    generate += r.get('generate_seconds', 0)
    if 'error' in r:
        groups['did not generate'].append((key, r['error'][:70])); continue
    cs = [c for c in r['clocks'] if c.get('is_stable', True)]
    for c in r['clocks']:
        if verbose or not c.get('is_stable', True):
            print(f"    {key} {'*' if c['selected'] else ' '} {c['id']:28} {'' if c.get('is_stable', True) else '(not stable) '}{word(c)}")
    if not cs:
        groups['no stable clock'].append((key, '')); continue
    clocks += len(cs); trials += sum(c['seconds'] for c in cs)
    errors += sum('error' in c for c in cs); hold += sum(c.get('holds') is True for c in cs)
    slowest = max([slowest] + [c['back_after_periods'] for c in cs if c.get('holds')])
    failing = [c for c in cs if not c.get('holds')]
    note = f"{len(cs) - len(failing)} of {len(cs)} stable clocks hold" + (f"; fail: {', '.join(c['id'] for c in failing)}" if failing else '')
    sel = next((c for c in cs if c['selected']), None)
    if sel is not None and sel.get('holds'):
        groups['selected clock holds'].append((key, f"{sel['id']}; {note}"))
    else:
        groups['selected clock fails'].append((key, f"{sel['id'] + ': ' + word(sel) if sel else 'selected ' + str(r.get('selected')) + ' is not stable'}; {note}"))
for name, rows in groups.items():
    print(f"\n{name}: {len(rows)}")
    for key, text in rows:
        print(f"  {key}: {text}" if text else f"  {key}")
print(f"\n{clocks} stable clocks: {hold} hold, {clocks - hold - errors} fail, {errors} could not be tried; the slowest to hold is there within {slowest} periods")
print(f"generating took {generate:.0f} s and the trials {trials:.0f} s of processor time ({trials / max(generate, 1) * 100:.0f}% on top)")
