#!/usr/bin/env python3
# scripts/margin-table.py <dir of margin-sample.js output> [-v]
# For each sample: whether its selected clock holds with every window a tick shorter at its start, and at its end,
# and how many of its stable clocks do. -v lists every clock. Simulator only.
import json, glob, os, sys
d = sys.argv[1]; verbose = '-v' in sys.argv
word = lambda t: 'not tried' if t is None else 'error' if 'error' in t else 'holds' if t['holds'] else f"fails ({t['items']})"
ok = lambda t: t is not None and t.get('holds') is True
clocks = both = start_fails = end_fails = not_tried = 0
generate = trials = 0.0
selected = {'holds both ways': [], 'fails': [], 'not tried as planned': [], 'no stable clock': [], 'did not generate': []}
for f in sorted(glob.glob(os.path.join(d, '*.json'))):
    r = json.load(open(f)); key = r['key']
    generate += r.get('generate_seconds', 0)
    if 'error' in r:
        selected['did not generate'].append((key, r['error'][:70])); continue
    cs = r['clocks']
    if not cs:
        selected['no stable clock'].append((key, '')); continue
    survivors = 0
    for c in cs:
        clocks += 1
        trials += sum(c[t]['seconds'] for t in ('unchanged', 'shorter_at_start', 'shorter_at_end'))
        if not ok(c['unchanged']):
            not_tried += 1
        else:
            start_fails += not ok(c['shorter_at_start']); end_fails += not ok(c['shorter_at_end'])
            if ok(c['shorter_at_start']) and ok(c['shorter_at_end']):
                both += 1; survivors += 1
        if verbose:
            print(f"    {key} {'*' if c['selected'] else ' '} {c['id']:28} unchanged {word(c['unchanged'])}, start {word(c['shorter_at_start'])}, end {word(c['shorter_at_end'])} of {c['expected']}")
    sel = next((c for c in cs if c['selected']), None)
    note = f"{survivors} of {len(cs)} stable clocks hold both ways"
    if sel is None:
        selected['fails'].append((key, f"selected {r.get('selected')} is not stable; {note}"))
    elif not ok(sel['unchanged']):
        selected['not tried as planned'].append((key, f"{sel['id']} unchanged: {word(sel['unchanged'])}; {note}"))
    elif ok(sel['shorter_at_start']) and ok(sel['shorter_at_end']):
        selected['holds both ways'].append((key, f"{sel['id']}; {note}"))
    else:
        selected['fails'].append((key, f"{sel['id']}: start {word(sel['shorter_at_start'])}, end {word(sel['shorter_at_end'])} of {sel['expected']}; {note}"))
for name, rows in selected.items():
    print(f"\nselected clock {name}: {len(rows)}" if name in ('holds both ways', 'fails', 'not tried as planned') else f"\n{name}: {len(rows)}")
    for key, text in rows:
        print(f"  {key}: {text}" if text else f"  {key}")
tried = clocks - not_tried
print(f"\n{clocks} stable clocks; {not_tried} not tried as planned; of the other {tried}: {both} hold both ways, "
      f"{start_fails} fail a tick shorter at the start, {end_fails} a tick shorter at the end")
print(f"generating took {generate:.0f} s and the trials {trials:.0f} s of processor time ({trials / max(generate, 1) * 100:.0f}% on top)")
