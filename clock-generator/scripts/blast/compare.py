#!/usr/bin/env python3
"""Compare two blast-radius runs: per job, the selected clock's hash, id, verdict, holds, rate and supply, and how many
alternatives' exported clocks changed. The clock hash is of the clock's identity (no text); alternatives whose text alone
changed (text_sha256, where both sides have it) are counted apart.

usage: compare.py <before> <after> [--json out.json]

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

def is_check(j):
    return 'refused' in j

before, after = load(sys.argv[1]), load(sys.argv[2])
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
    fields = ['id', 'verdict', 'holds', 'rate', 'supply', 'period']
    changed_fields = [f for f in fields if sb[f] != sa[f]]
    alt_b = {x['id']: x['clock_sha256'] for x in b['alternatives']}
    alt_a = {x['id']: x['clock_sha256'] for x in a['alternatives']}
    alt_changed = sorted(i for i in set(alt_b) | set(alt_a) if alt_b.get(i) != alt_a.get(i))
    text_b = {x['id']: x.get('text_sha256') for x in b['alternatives']}
    text_a = {x['id']: x.get('text_sha256') for x in a['alternatives']}
    text_only = sorted(i for i in set(alt_b) & set(alt_a) if alt_b[i] == alt_a[i] and text_b[i] and text_a[i] and text_b[i] != text_a[i])
    alt_verdicts = sorted(f"{x['id']}:{y['verdict']}->{x['verdict']}" for x in a['alternatives'] for y in b['alternatives']
                          if x['id'] == y['id'] and (x['verdict'] != y['verdict'] or x['holds'] != y['holds']))
    rows.append({
        'key': key, 'status': 'ok', 'selected_hash_changed': sb['clock_sha256'] != sa['clock_sha256'],
        'selected_fields_changed': {f: [sb[f], sa[f]] for f in changed_fields},
        'before': {f: sb[f] for f in fields + ['clock_sha256']}, 'after': {f: sa[f] for f in fields + ['clock_sha256']},
        'wake_ups': [sb.get('wake_ups'), sa.get('wake_ups')],
        'alternatives_hash_changed': alt_changed, 'alternative_verdict_changes': alt_verdicts,
        'alternatives_text_only_changed': text_only,
    })

hash_changed = [r for r in rows if r.get('selected_hash_changed')]
verdict_only = [r for r in rows if r['status'] == 'ok' and not r['selected_hash_changed'] and r['selected_fields_changed']]
alt_only = [r for r in rows if r['status'] == 'ok' and not r['selected_hash_changed'] and not r['selected_fields_changed'] and (r['alternatives_hash_changed'] or r['alternative_verdict_changes'])]
text_only = sum(len(r.get('alternatives_text_only_changed', [])) for r in rows)
print(f"jobs {len(rows)}; selected clock hash changed: {len(hash_changed)}; selection fields changed without a hash change: {len(verdict_only)}; only other alternatives changed: {len(alt_only)}; alternatives whose text alone changed: {text_only}")
for title, group in [('selected clock hash changed', hash_changed), ('selected verdict/holds changed, same clock', verdict_only), ('only other alternatives changed', alt_only)]:
    print(f'\n## {title}')
    for r in group:
        print(f"- {r['key']}: {r['selected_fields_changed'] or ''} before {r['before']['id']} {r['before']['verdict']} holds={r['before']['holds']} {r['before']['clock_sha256'][:12]} -> after {r['after']['id']} {r['after']['verdict']} holds={r['after']['holds']} {r['after']['clock_sha256'][:12]}; wake-ups {r['wake_ups']}; alternatives changed {len(r['alternatives_hash_changed'])}; alt verdict changes {r['alternative_verdict_changes']}")
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
if '--json' in sys.argv:
    json.dump(rows, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1)
