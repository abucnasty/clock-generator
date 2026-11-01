#!/usr/bin/env python3
"""Project sealed normalized native evidence; no game, debugger or production simulation.
Usage (from clock-generator):
  python3 scripts/scheduler/project-native-fixtures.py SOURCE_DIR [--out OUTPUT_DIR]
SOURCE_DIR contains the three original bounded fixtures and SHA256SUMS. Default output:
  tests/game/mechanics/activation-order/fixtures
Full recordings/probes remain outside the compact fixture tree. This selects existing
observations without upgrading inferred Deactivation intervals to intercepted calls.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('--out', type=Path, default=Path('tests/game/mechanics/activation-order/fixtures'))
args = parser.parse_args()
seals = {name: digest for digest, name in (line.split() for line in (args.source/'SHA256SUMS').read_text().splitlines() if line)}
args.out.mkdir(parents=True, exist_ok=True)
for case, first, last in [('agricultural', 4836, 4838), ('agricultural-belt', 4836, 4838), ('lds-diagnostic', 5629, 5630)]:
    filename = case+'.json'
    raw = (args.source/filename).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == seals[filename], f'unsealed source: {filename}'
    source = json.loads(raw)
    events = source['observed']['events']
    selected = [dict(event, source_event=i) for i, event in enumerate(events)
                if first <= event['tick'] <= last and source['entities'][event['role']]['type'] == 'inserter']
    indices = {event['source_event'] for event in selected}
    transitions = [dict(transition,
                        from_observation={key: events[transition['from_event']][key] for key in ['tick', 'game_tick', 'sequence', 'raw_seq', 'event']},
                        through_observation={key: events[transition['through_event']][key] for key in ['tick', 'game_tick', 'sequence', 'raw_seq', 'event']})
                   for transition in source['transitions'] if transition['through_event'] in indices]
    active = [event['role'] for event in selected if event['tick'] == first and event['event'] == 'Update']
    projected = {
        'format': 'native-scheduler-projection-1', 'case': case, 'factorio_version': source['factorio_version'],
        'source_fixture': {'name': filename, 'sha256': digest},
        'source_input_hashes': source['input_hashes'], 'source_provenance': source['provenance'],
        'clock_scope': source['clock_scope'], 'entities': source['entities'], 'tick_mapping': source['tick_mapping'],
        'projection': {'first_tick': first, 'last_tick': last,
                       'initial_active_order': active,
                       'initial_state_basis': 'selected first-tick Update entries; other selected hands first observed inactive at Alarm',
                       'deactivation_policy': 'apply only at inactive observation ending an inferred interval; not an exact detach time'},
        'events': selected, 'transitions': transitions,
        'caller_chains': {str(i): source['observed']['caller_chains'][i] for i in sorted({event['caller_chain'] for event in selected})},
        'visible_rows': [row for row in source['observed']['visible_rows'] if first <= row['tick'] <= last+1],
        'native_assertions': source['assertions'],
        'reference_equality': source['observed']['reference_equality'],
        'handshake': source['observed']['handshake'], 'code_site_checks': source['observed']['code_site_checks'],
        'limits': source['limits'] + ['Scheduling-only replay supplies native Alarms and membership outcomes; World/hand physics are not integrated.']
    }
    output = args.out/filename
    output.write_text(json.dumps(projected, indent=2)+'\n')
    print(f'{filename}: {len(selected)} events, {len(transitions)} transitions, {output.stat().st_size} bytes')
(args.out/'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in sorted(args.out.glob('*.json'))))
