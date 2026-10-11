#!/usr/bin/env python3
# scripts/backpressure-table.py <dir of backpressure-sample.js output> [-v]
# For each sample: whether its selected clock survives backpressure loss, another of its stable clocks does, or none
# does, and the losses that break the ones that do not. -v lists every clock. Simulator only.
import json, glob, os, sys
d = sys.argv[1]; verbose = '-v' in sys.argv
groups = {'selected survives': [], 'another clock survives': [], 'no clock survives': [], 'no stable clock': [], 'did not generate': []}
seconds = generate = trials = 0; clocks = 0
for f in sorted(glob.glob(os.path.join(d, '*.json'))):
    r = json.load(open(f)); key = r['key']
    seconds += r.get('seconds', 0); generate += r.get('generate_seconds', 0)
    if 'error' in r:
        groups['did not generate'].append((key, r['error'][:70])); continue
    cs = r['clocks']; clocks += len(cs); trials += sum(c.get('seconds', 0) for c in cs)
    if not cs:
        groups['no stable clock'].append((key, '')); continue
    off = [c['id'] for c in cs if c.get('error') or c.get('holds_undisturbed') is False]
    note = f" (not tried as planned: {', '.join(off)})" if off else ''
    sel = next((c for c in cs if c['selected']), None)
    survivors = [c['id'] for c in cs if c.get('survives')]
    broken = lambda c: ', '.join(c.get('broken_by') or ([] if c.get('holds_undisturbed', True) else ['off with nothing cut'])) or c.get('error', '')[:50]
    if sel is not None and sel.get('survives'):
        groups['selected survives'].append((key, f"{sel['id']}, back within {sel['recovered_after_periods']} periods{note}"))
    elif survivors:
        groups['another clock survives'].append((key, f"selected {sel['id'] if sel else r.get('selected')} broken by: {broken(sel) if sel else 'not stable'}; survive: {', '.join(survivors)}{note}"))
    else:
        groups['no clock survives'].append((key, f"selected {sel['id'] if sel else r.get('selected')} broken by: {broken(sel) if sel else 'not stable'}{note}"))
    if verbose:
        for c in cs:
            print(f"    {key} {'*' if c['selected'] else ' '} {c['id']:28} {'survives' if c.get('survives') else 'broken by ' + broken(c)}")
for name, rows in groups.items():
    print(f"\n{name}: {len(rows)}")
    for key, text in rows:
        print(f"  {key}: {text}" if text else f"  {key}")
print(f"\n{clocks} stable clocks tried; generating took {generate:.0f} s and the loss trials {trials:.0f} s of processor time ({trials / max(generate, 1) * 100:.0f}% on top)")
