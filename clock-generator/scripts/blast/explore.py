#!/usr/bin/env python3
"""List what an explore blast found: for each job, the clock the shipped strategies selected, the best clock of the explored strategies
and which of them wins by the ranking that selects (a tie keeps the shipped clock).

usage: explore.py <jobs> [--csv file]   exit 1, naming the problem, when the folder has no jobs or a job has no `explored`

<jobs> is a folder of job files made under CLOCK_EXPLORE=1 (blast.sh run --explore <worktree> <out>) or a cache entry of such a run.
Files whose name starts with "_" (the job list) are not jobs. A job that failed to generate is listed as an error. Explored strategies
that made the same clock as a shipped run are not clocks of their own; `same` lists the ids of their alternatives. Nothing but --csv is written.
"""
import csv, glob, json, os, sys


def load(path):
    if os.path.exists(os.path.join(path, 'MANIFEST.json')):
        path = os.path.join(path, 'jobs')
    jobs = {}
    for f in glob.glob(os.path.join(path, '*.json')):
        if os.path.basename(f).startswith('_'):
            continue
        j = json.load(open(f))
        jobs[f"{j['group']}-{j['name']}"] = j
    return jobs


def wakeups(clock):
    if clock is None:
        return '-'
    w = clock.get('wake_ups_per_minute')
    return 'n/a' if w is None else f"{w:,.1f}"


def cells(clock):
    """strategy, wakeups a minute, verdict of a clock; dashes where there is none"""
    if clock is None:
        return ['-', '-', '-']
    return [clock['strategy'], wakeups(clock), clock['verdict']]


args = sys.argv[1:]
csv_file = None
if '--csv' in args:
    i = args.index('--csv')
    if i + 1 >= len(args):
        sys.exit('usage: explore.py <jobs> [--csv file]')
    csv_file = args[i + 1]
    del args[i:i + 2]
if len(args) != 1:
    sys.exit('usage: explore.py <jobs> [--csv file]')
jobs = load(args[0])
if not jobs:
    sys.exit(f"explore.py: no jobs in {args[0]}: not a folder of job files or a cache entry")

rows, errors, missing = [], [], []
for key in sorted(jobs):
    j = jobs[key]
    if 'error' in j:
        errors.append((key, j['error']))
        continue
    e = j.get('explored')
    if e is None:
        missing.append(key)
        continue
    winner = '-' if e['best'] is None else ('explored' if e['beats_selection'] else 'shipped')
    saved = None
    if winner == 'explored' and e['selected'] is not None and e['selected'].get('wake_ups_per_minute') is not None \
            and e['best'].get('wake_ups_per_minute') is not None:
        saved = e['selected']['wake_ups_per_minute'] - e['best']['wake_ups_per_minute']
    rows.append([key] + cells(e['selected']) + cells(e['best']) + [winner, '' if saved is None else f"{saved:,.1f}", ','.join(e['same_as_shipped'])])
if missing:
    sys.exit(f"explore.py: {len(missing)} job(s) have no `explored` (not made under CLOCK_EXPLORE=1): {', '.join(missing[:5])}{' ...' if len(missing) > 5 else ''}")

header = ['job', 'shipped strategy', 'wakeups/min', 'verdict', 'explored strategy', 'wakeups/min', 'verdict', 'wins', 'saved/min', 'same']
# the jobs the explored clock wins first, the largest saving first; then the rest by name
rows.sort(key=lambda r: (r[7] != 'explored', -float(r[8].replace(',', '')) if r[8] else 0.0, r[0]))
widths = [max(len(header[i]), *(len(r[i]) for r in rows)) if rows else len(header[i]) for i in range(len(header))]
line = lambda r: '  '.join(c.ljust(widths[i]) for i, c in enumerate(r)).rstrip()
print(line(header))
print(line(['-' * w for w in widths]))
for r in rows:
    print(line(r))
won = sum(1 for r in rows if r[7] == 'explored')
lost = sum(1 for r in rows if r[7] == 'shipped')
none = sum(1 for r in rows if r[7] == '-')
print(f"\n{len(rows)} jobs: the explored clock wins {won}, the shipped clock wins {lost}, no explored clock {none}" + (f"; {len(errors)} errors" if errors else ''))
for key, error in errors:
    print(f"error {key}: {error}")
if csv_file:
    with open(csv_file, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
sys.exit(0)
