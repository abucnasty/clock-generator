#!/usr/bin/env python3
"""Compare two blast-radius runs: per job, the selected clock's hash, id, verdict, holds, rate and supply, and how many
alternatives' exported clocks changed. The clock hash is of the clock's identity (no text); alternatives whose text alone
changed (text_sha256, where both sides have it) are counted apart. The results digest (results_sha256, with the sha of
each component beside it) covers what the clock hash leaves out (label, description, insights, verdict, assessment, the
histories, the clock-only run, the fuel view, why_not_stable): a job whose digest differs is listed with the alternative
and component that moved, whether or not its clock did. A side without the digest (a cache entry from before it) is named.

usage: compare.py [--map renames.txt] <before> <after> [--json out.json]   exit 1, naming the side, when a side has no jobs

--map: a rename map, one pair a line, `old-job-key new-job-key` in the job list's key form (`config-OLD config-NEW`),
whitespace separated, '#' starts a comment, blank lines are ignored. The before side's jobs are renamed through it before
the join, so a renamed job compares with its new name instead of showing as missing after / only in after. It also
compares the config hash (config_sha256 of each side's _jobs.json) of every renamed job: a pure rename keeps it, and a job
whose hash differs or is missing is listed. Exit 1 on a malformed line (not two names, or old == new), on two old names
mapping to one new name, or when a renamed job lands on a name the before side already has; map entries whose old name is
not in the before side are only named ("map entries not in before"). Without --map nothing changes.

Each side is a folder of job files (blast.sh run <out>) or a cache entry (<cache>/<key>/ or its jobs/).
Files whose name starts with "_" (the job list) are not jobs. A refusal check (group refusal: a job with `refused`)
compares by whether it was refused and its errors; the after side's checks are listed.
"""
import json, os, sys, glob

def load(d):
    if os.path.exists(os.path.join(d, 'MANIFEST.json')):
        d = os.path.join(d, 'jobs')
    out = {}
    for f in glob.glob(os.path.join(d, '*.json')):
        if os.path.basename(f).startswith('_'):
            continue
        j = json.load(open(f)); out[f"{j['group']}:{j['name']}"] = j
    return out

def load_list(d):
    """The job list (_jobs.json) of a side as {key: job-list entry}, or None where the side has none"""
    if os.path.exists(os.path.join(d, 'MANIFEST.json')):
        d = os.path.join(d, 'jobs')
    f = os.path.join(d, '_jobs.json')
    if not os.path.exists(f):
        return None
    return {e['key']: e for e in json.load(open(f)).get('jobs', [])}

def join_key(k, lists, groups):
    """a job list key ('config-NAME') as the join key ('config:NAME'): by the job lists where they have it, else by the longest
    known group that prefixes it (a group may hold a '-', config-backed), else at the first '-'"""
    for lst in lists:
        if lst and k in lst:
            return f"{lst[k]['group']}:{lst[k]['name']}"
    for g in sorted(groups, key=len, reverse=True):
        if k.startswith(g + '-'):
            return f"{g}:{k[len(g) + 1:]}"
    return k.replace('-', ':', 1)

def load_map(path):
    """the rename map as [(old, new)] in job-list key form; exits 1 naming the line when one is malformed, or when two old
    names map to one new name"""
    pairs = []
    try:
        lines = open(path).read().splitlines()
    except OSError as e:
        sys.exit(f"compare.py: cannot read the map {path}: {e.strerror}")
    for n, line in enumerate(lines, 1):
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            sys.exit(f"compare.py: {path} line {n}: expected 'old-job-key new-job-key', got {line!r}")
        if parts[0] == parts[1]:
            sys.exit(f"compare.py: {path} line {n}: {parts[0]} maps to itself")
        pairs.append((parts[0], parts[1]))
    by_old, by_new = {}, {}
    for old, new in pairs:
        if by_old.setdefault(old, new) != new:
            sys.exit(f"compare.py: {path}: {old} maps to both {by_old[old]} and {new}")
        if by_new.setdefault(new, old) != old:
            sys.exit(f"compare.py: {path}: {by_new[new]} and {old} both map to {new}")
    return list(by_old.items())

def is_check(j):
    return 'refused' in j

def field_of(alternative, name):
    """a field of an alternative; a job file written before the window cycle was named has it as `period`"""
    if name == 'window_cycle_ticks' and name not in alternative:
        return alternative['period']
    return alternative[name]


def results_moved(b, a):
    """The components of the results digest that differ between two sides of a job, as 'job:name' or 'alternative:name';
    None where a side has no digest"""
    if 'results_sha256' not in b or 'results_sha256' not in a:
        return None
    moved = [f"job:{n}" for n in sorted(set(b['job_results']['results']) | set(a['job_results']['results']))
             if b['job_results']['results'].get(n) != a['job_results']['results'].get(n)]
    alt_b = {x['id']: x['results'] for x in b['alternatives']}
    alt_a = {x['id']: x['results'] for x in a['alternatives']}
    for i in sorted(set(alt_b) | set(alt_a)):
        if i not in alt_b or i not in alt_a:
            moved.append(f"{i}:{'added' if i in alt_a else 'removed'}"); continue
        moved += [f"{i}:{n}" for n in sorted(set(alt_b[i]) | set(alt_a[i])) if alt_b[i].get(n) != alt_a[i].get(n)]
    return moved

def parse_args(argv):
    """(positional, map file or None, json out or None); --map and --json take the argument after them, anywhere"""
    pos, map_file, json_out, i = [], None, None, 0
    while i < len(argv):
        if argv[i] in ('--map', '--json'):
            if i + 1 >= len(argv):
                sys.exit(f"compare.py: {argv[i]} takes a file")
            if argv[i] == '--map':
                map_file = argv[i + 1]
            else:
                json_out = argv[i + 1]
            i += 2
        else:
            pos.append(argv[i]); i += 1
    return pos, map_file, json_out

args, map_file, json_out = parse_args(sys.argv[1:])
if len(args) < 2:
    sys.exit("usage: compare.py [--map renames.txt] <before> <after> [--json out.json]")
before, after = load(args[0]), load(args[1])
# a side with no job compares nothing, and "no change" of nothing is not a proof
empty = [f"{name} ({args[i]})" for i, (name, side) in ((0, ('before', before)), (1, ('after', after))) if not side]
if empty:
    sys.exit(f"compare.py: no jobs in the {' or the '.join(empty)}: not a folder of job files or a cache entry")
summary = []
if map_file:
    lists = load_list(args[0]), load_list(args[1])
    groups = {j['group'] for side in (before, after) for j in side.values()} | {e['group'] for lst in lists if lst for e in lst.values()}
    pairs = [(old, new, join_key(old, lists[:1], groups), join_key(new, lists[1:], groups)) for old, new in load_map(map_file)]
    renamed = [p for p in pairs if p[2] in before]
    absent = [p[0] for p in pairs if p[2] not in before]
    moved = {p[2]: p[3] for p in renamed}
    renamed_before = {moved.get(k, k): j for k, j in before.items()}
    if len(renamed_before) != len(before):
        names = [moved.get(k, k) for k in before]
        clash = sorted({n for n in names if names.count(n) > 1})
        sys.exit(f"compare.py: the map renames a job onto a name the before side has: {clash}")
    before = renamed_before
    summary.append(f"renamed through the map: {len(renamed)} jobs")
    if absent:
        summary.append(f"map entries not in before: {absent}")
    if lists[0] is None or lists[1] is None:
        summary.append(f"config hashes of renamed jobs not compared: {'the before side' if lists[0] is None else 'the after side'} has no job list (_jobs.json)")
    else:
        bad = []
        for old, new, _, _ in renamed:
            h_old, h_new = lists[0].get(old, {}).get('config_sha256'), lists[1].get(new, {}).get('config_sha256')
            if not h_old or not h_new:
                bad.append(f"{old} -> {new}: no config hash ({'before' if not h_old else 'after'})")
            elif h_old != h_new:
                bad.append(f"{old} -> {new}: config hash differs")
        summary.append(f"config hashes of renamed jobs: {len(renamed) - len(bad)} of {len(renamed)} equal")
        summary += [f"  - {b}" for b in bad]
rows = []
only_after = sorted(set(after) - set(before))
for key in sorted(before):
    b, a = before[key], after.get(key)
    if a is None:
        rows.append({'key': key, 'status': 'missing after'}); continue
    if is_check(b) or is_check(a):
        same = is_check(b) and is_check(a) and (b['refused'], b['errors']) == (a['refused'], a['errors'])
        rows.append({'key': key, 'status': 'refusal', 'same': same}); continue
    if 'error' in b or 'error' in a:
        rows.append({'key': key, 'status': 'error', 'same_error': b.get('error') == a.get('error')}); continue
    sb, sa = b['selected'], a['selected']
    fields = ['id', 'verdict', 'holds', 'rate', 'supply', 'window_cycle_ticks']
    changed_fields = [f for f in fields if field_of(sb, f) != field_of(sa, f)]
    alt_b = {x['id']: x['clock_sha256'] for x in b['alternatives']}
    alt_a = {x['id']: x['clock_sha256'] for x in a['alternatives']}
    alt_changed = sorted(i for i in set(alt_b) | set(alt_a) if alt_b.get(i) != alt_a.get(i))
    text_b = {x['id']: x.get('text_sha256') for x in b['alternatives']}
    text_a = {x['id']: x.get('text_sha256') for x in a['alternatives']}
    text_only = sorted(i for i in set(alt_b) & set(alt_a) if alt_b[i] == alt_a[i] and text_b[i] and text_a[i] and text_b[i] != text_a[i])
    alt_verdicts = sorted(f"{x['id']}:{y['verdict']}->{x['verdict']}" for x in a['alternatives'] for y in b['alternatives']
                          if x['id'] == y['id'] and (x['verdict'] != y['verdict'] or x['holds'] != y['holds']))
    results = results_moved(b, a)
    rows.append({
        'key': key, 'status': 'ok', 'selected_hash_changed': sb['clock_sha256'] != sa['clock_sha256'],
        'results_changed': results, 'results_digest': None if results is None else b['results_sha256'] != a['results_sha256'],
        'selected_fields_changed': {f: [field_of(sb, f), field_of(sa, f)] for f in changed_fields},
        'before': {f: field_of(sb, f) for f in fields + ['clock_sha256']}, 'after': {f: field_of(sa, f) for f in fields + ['clock_sha256']},
        'wake_ups': [sb.get('wake_ups'), sa.get('wake_ups')],
        'alternatives_hash_changed': alt_changed, 'alternative_verdict_changes': alt_verdicts,
        'alternatives_text_only_changed': text_only,
    })

hash_changed = [r for r in rows if r.get('selected_hash_changed')]
verdict_only = [r for r in rows if r['status'] == 'ok' and not r['selected_hash_changed'] and r['selected_fields_changed']]
alt_only = [r for r in rows if r['status'] == 'ok' and not r['selected_hash_changed'] and not r['selected_fields_changed'] and (r['alternatives_hash_changed'] or r['alternative_verdict_changes'])]
text_only = sum(len(r.get('alternatives_text_only_changed', [])) for r in rows)
results_changed = [r for r in rows if r['status'] == 'ok' and r['results_changed']]
undigested = [r['key'] for r in rows if r['status'] == 'ok' and r['results_changed'] is None]
print(f"jobs {len(rows)}; selected clock hash changed: {len(hash_changed)}; selection fields changed without a hash change: {len(verdict_only)}; only other alternatives changed: {len(alt_only)}; alternatives whose text alone changed: {text_only}; results digest changed: {len(results_changed)}")
for line in summary:
    print(line)
for title, group in [('selected clock hash changed', hash_changed), ('selected verdict/holds changed, same clock', verdict_only), ('only other alternatives changed', alt_only)]:
    print(f'\n## {title}')
    for r in group:
        print(f"- {r['key']}: {r['selected_fields_changed'] or ''} before {r['before']['id']} {r['before']['verdict']} holds={r['before']['holds']} {r['before']['clock_sha256'][:12]} -> after {r['after']['id']} {r['after']['verdict']} holds={r['after']['holds']} {r['after']['clock_sha256'][:12]}; wake-ups {r['wake_ups']}; alternatives changed {len(r['alternatives_hash_changed'])}; alt verdict changes {r['alternative_verdict_changes']}")
print('\n## results digest changed')
for r in results_changed:
    print(f"- {r['key']}: {', '.join(r['results_changed'])}")
if undigested:
    print(f"results digest not compared (a side has none): {len(undigested)} jobs")
checks = [j for j in after.values() if is_check(j)]
if checks:
    failed = sorted(f"{j['group']}:{j['name']}" for j in checks if not j['refused'])
    changed = [r['key'] for r in rows if r['status'] == 'refusal' and not r['same']]
    print(f"\nrefusal checks (after) {len(checks)}; refused with the expected error {len(checks) - len(failed)}"
          + (f"; NOT AS EXPECTED: {failed}" if failed else '') + (f"; changed since before: {changed}" if changed else ''))
errors = [r for r in rows if r['status'] not in ('ok', 'refusal')]
print('\nerrors/missing:', [(r['key'], r['status'], r.get('same_error')) for r in errors])
# Factorio keeps 500 bytes of a description (2.1.21): no alternative may need one cut
cut = sorted(f"{key}:{alt['id']} ({alt['descriptions_cut']})" for key, j in after.items() if not is_check(j) and 'error' not in j
             for alt in j.get('alternatives', []) if alt.get('descriptions_cut'))
print('descriptions cut (after):', cut if cut else 'none')
if only_after:
    print('only in after:', only_after)
if json_out:
    json.dump(rows, open(json_out, 'w'), indent=1)
