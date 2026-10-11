#!/usr/bin/env python3
# scripts/compare-counts.py <before.txt> <after.txt>
# Two outputs of count-runs.js (one line a sample) side by side: the runs of the build and the ticks simulated each
# sample takes before and after a change, and the totals. For a change of the searches that must not make generation
# slower.
import re, sys

def load(path):
    rows = {}
    for line in open(path):
        m = re.match(r"(\S+) runs (\d+) ticks (\d+) seconds (\d+)(.*)", line)
        if m:
            rows[m.group(1)] = (int(m.group(2)), int(m.group(3)), int(m.group(4)), m.group(5).strip())
    return rows

before, after = load(sys.argv[1]), load(sys.argv[2])
print(f"{'sample':<48} {'runs before':>11} {'after':>7} {'ticks before':>13} {'after':>11} {'s before':>8} {'after':>6}")
tr = ta = tt = tu = 0
for key in sorted(set(before) | set(after)):
    b, a = before.get(key), after.get(key)
    if b is None or a is None:
        print(f"{key:<48} only in {'after' if b is None else 'before'}")
        continue
    flag = "" if a[0] == b[0] and a[1] == b[1] else "  <- differs"
    print(f"{key:<48} {b[0]:>11} {a[0]:>7} {b[1]:>13} {a[1]:>11} {b[2]:>8} {a[2]:>6}{flag}{(' ' + a[3]) if a[3] else ''}")
    tr += b[0]; ta += a[0]; tt += b[1]; tu += a[1]
print(f"{'total':<48} {tr:>11} {ta:>7} {tt:>13} {tu:>11}")
