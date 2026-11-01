#!/usr/bin/env python3
"""Select paired native notifications, membership changes and Updates; no game/debugger.
Usage (from clock-generator):
  python3 scripts/scheduler/project-notification-fixtures.py RELEASE_INVESTIGATIONS_DIR
Writes compact fixtures under tests/game/mechanics/activation-order/fixtures.
Source evidence, normalized-comparison limits and exact captured scaffolds are retained;
full recordings and generated probes stay in the external research packages.
"""
import hashlib
import json
from pathlib import Path
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('packages', type=Path)
args = parser.parse_args()
root = Path('tests/game/mechanics/activation-order/fixtures')
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
read = lambda path: json.loads(path.read_text())

# RI5 already pairs verified native entry/return and separately declares the shifted second origin.
pkg = args.packages/'05-partial-hand-sleep'
partial = read(pkg/'mechanics.json')
assert sha(pkg/'mechanics.json') == 'fa3f93491237e27e74d4db08162f47575411f1606cde3dc180e15aa9ad0b4abe'
assert partial['comparison']['raw_reference_capture01_equal']
assert partial['comparison']['declared_origin_relative_visible_equal']
assert partial['comparison']['events_without_untyped_raw_rax_equal']
visible = read(pkg/'.scratch/capture01/visible.json')
partial['initial'] = visible['initial']
partial['initial_active_order'] = ['hand_3']
partial['initial_state_basis'] = 'first native mapping: hand_3 linked; hand_1/2 inactive/self-linked'
partial['window'] = {'first_tick': 1, 'last_tick': 20}
partial['source_projection_sha256'] = sha(pkg/'mechanics.json')
partial['source_seal'] = read(pkg/'.scratch/capture01/SHA256.json')
partial['scaffold_sha256'] = sha(pkg/'.scratch/reference02/scaffold.txt')
partial['provenance']['.scratch/reference02/scaffold.txt'] = partial['scaffold_sha256']
(root/'partial-hand/observations.json').write_text(json.dumps(partial, indent=2)+'\n')

# RI2 compact entry/return order is independently repeated exactly and has no absolute-origin difference.
pkg = args.packages/'02-control-transitions'
validation = read(pkg/'evidence/validation.json')
assert validation['pass'] and validation['raw_whole_reference_equal'] and validation['repeat_events'] == 307
raw = read(pkg/'evidence/events.json')['events']
visible = read(pkg/'.scratch/capture01/visible.json')
semantics = {'Inserter::alarm': 'Alarm', 'Inserter::update': 'Update',
             'UpdatableEntity::attachInternal': 'Activation', 'UpdatableEntity::deactivate': 'Deactivation'}
pending = {}
events = []
for index, event in enumerate(raw):
    role = event['role']
    if not role.startswith('hand_') or event['event'] not in semantics:
        continue
    key = (role, event['event'])
    if event['kind'] == 'call':
        pending.setdefault(key, []).append((index, event))
        continue
    if event['kind'] != 'return':
        continue
    entry_index, entry = pending[key].pop()
    kind = semantics[event['event']]
    before = entry['membership']
    if kind == 'Activation':
        previous = [e for e in raw[:entry_index] if e['kind'] == 'call' and e['role'] == role and e['event'] == 'Inserter::alarm'][-1]
        assert not previous['membership']['bit'] and previous['membership']['self_linked']
        before = previous['membership']
    after = event['membership']
    if kind == 'Deactivation':
        assert before['bit'] and not before['self_linked'] and not after['bit'] and after['self_linked']
    if kind == 'Activation':
        assert after['bit'] and not after['self_linked']
    state = lambda s: {'active': s['bit'], 'self_linked': s['self_linked']}
    events.append({'event': kind, 'probe_tick': entry['tick'], 'game_tick': visible['started']+entry['tick'],
                   'seq': entry_index, 'return_seq': index, 'sequence_namespace': 'index in repeated compact native entry/return sequence',
                   'role': role, 'native_unit': visible['roles'][role], 'function': entry['event'],
                   'caller': entry.get('callers', ['scheduled entity-list update'])[0],
                   'before': state(before), 'after': state(after),
                   'evidence': 'intercepted selected call and return'})
events.sort(key=lambda event: event['seq'])
assert all(not stack for stack in pending.values())
result = {
    'schema': 1, 'contract': 'Mechanics: observed condition assignment notifications; no control replacement equivalence',
    'version': '2.1.21', 'binary_sha256': partial['binary_sha256'],
    'source_projection_sha256': sha(pkg/'evidence/events.json'),
    'comparison': validation, 'source_seal': read(pkg/'.scratch/capture01/SHA256.json'),
    'initial': visible['initial'], 'id_namespaces': {'native_roles': visible['roles'], 'config_ids': 'not assigned; scaffold entity_number is separate'},
    'initial_active_order': [e['role'] for e in events if e['event'] == 'Update' and e['probe_tick'] == 1],
    'initial_state_basis': 'native first-tick Update order and linked entry states',
    'window': {'first_tick': 1, 'last_tick': 20},
    'tick_conversion': 'Absolute game tick=started+probe tick; actual probe k transfer appears in visible row k+1.',
    'events': events, 'visible': read(pkg/'evidence/visible-cells.json'),
    'scaffold_sha256': sha(pkg/'.scratch/reference03/scaffold.txt'),
    'provenance': {path: sha(pkg/path) for path in ['evidence/events.json', 'evidence/visible-cells.json', 'evidence/validation.json', '.scratch/reference03/scaffold.txt']},
    'scope': ['Flat condition assignments on existing green-wired entities; not simulator useControls or physical clock replacement.',
              'Initial full16 hands had delivered before the disable edge; no moving full-carry conclusion.',
              'Callback assignment vs end-of-tick finish-dispatch phases are observed; hidden pending/cache bits are not decoded.',
              'Native visible physics is context; scheduling replay does not derive hand/control outcomes.']
}
(root/'condition-writes/observations.json').write_text(json.dumps(result, indent=2)+'\n')
for case in ['partial-hand', 'condition-writes']:
    folder=root/case
    (folder/'SHA256SUMS').write_text(''.join(f'{sha(folder/name)}  {name}\n' for name in ['observations.json', 'scaffold.txt']))
    print(case, (folder/'observations.json').stat().st_size)
