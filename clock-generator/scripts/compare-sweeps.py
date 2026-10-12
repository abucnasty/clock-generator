#!/usr/bin/env python3
# scripts/compare-sweeps.py <before dir> <after dir> [-v]
# Two sweeps (see sweep.sh) laid against each other: the samples that generate other potential clocks, give one
# another verdict (stable, no recovery from a backpressure loss, unstable), rate, wake-ups, belt or period, select
# another clock, or leave other searches out. -v also lists clocks whose windows moved.
import json, os, sys

before_dir, after_dir = sys.argv[1:3]


def load(directory):
    return {name[:-5]: json.load(open(os.path.join(directory, name))) for name in sorted(os.listdir(directory)) if name.endswith(".json")}


def summary(alt):
    wake = alt["wake_ups_per_minute"]
    # a sweep from before a loss was tried has neither field: its verdict is of what the clock holds
    lost = alt.get("holds_expected_output") and not alt["is_stable"]
    verdict = "stable" if alt["is_stable"] else f"NO RECOVERY ({', '.join(alt.get('broken_by') or []) or 'off with nothing cut'})" if lost else "UNSTABLE"
    return (f"{verdict} {alt['items_per_second']:.4g}/s wake {wake if wake is None else round(wake, 1)} "
            f"belt {alt['belt']} period {alt['period']} windows {alt['window_count']}")


before, after = load(before_dir), load(after_dir)
same = 0
for key in sorted(set(before) | set(after)):
    x, y = before.get(key), after.get(key)
    if x is None or y is None:
        print(key, "only in", before_dir if y is None else after_dir)
        continue
    lines = []
    if x.get("error") != y.get("error"):
        lines.append(f"  error: {x.get('error')} -> {y.get('error')}")
    xa = {alt["id"]: alt for alt in x.get("alternatives", [])}
    ya = {alt["id"]: alt for alt in y.get("alternatives", [])}
    if x.get("deadlock_risks", []) != y.get("deadlock_risks", []):
        lines.append(f"  deadlock risk: {' '.join(x.get('deadlock_risks', [])) or 'none'} -> {' '.join(y.get('deadlock_risks', [])) or 'none'}")
    # a sweep from before the searches only ran when needed has no such field: it ran them all
    if x.get("skipped_searches", []) != y.get("skipped_searches", []):
        lines.append(f"  not searched: {', '.join(x.get('skipped_searches', [])) or 'nothing'} -> {', '.join(y.get('skipped_searches', [])) or 'nothing'}")
    if x.get("selected") != y.get("selected"):
        lines.append(f"  selected: {x.get('selected')} -> {y.get('selected')}")
    for alt_id in sorted(set(xa) | set(ya)):
        if alt_id not in xa:
            lines.append(f"  + {alt_id}: {summary(ya[alt_id])}")
        elif alt_id not in ya:
            lines.append(f"  - {alt_id}: {summary(xa[alt_id])}")
        else:
            sx, sy = summary(xa[alt_id]), summary(ya[alt_id])
            selected = "*" if alt_id == y.get("selected") else " "
            if sx != sy:
                lines.append(f" {selected} ~ {alt_id}: {sx}\n       -> {sy}")
            elif xa[alt_id]["windows"] != ya[alt_id]["windows"] and "-v" in sys.argv:
                lines.append(f" {selected} w {alt_id}: windows differ")
    if lines:
        print(key)
        print("\n".join(lines))
    else:
        same += 1
print(f"{same} of {len(set(before) | set(after))} samples the same")
