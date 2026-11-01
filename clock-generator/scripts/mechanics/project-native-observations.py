#!/usr/bin/env python3
"""Usage: python3 scripts/mechanics/project-native-observations.py /path/to/release-investigations

Offline, hash-gated promotion of delivered RI3/RI4/RI6 evidence. No game/debugger.
Raw sessions and generated probes remain in the research root's ignored .scratch.
"""
import base64
import hashlib
import json
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'tests/game/mechanics'
SOURCE = Path(sys.argv[1]).resolve()
PENDING = {}

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def read(p):
    return json.loads(p.read_text())

def write(p, value):
    PENDING[p] = (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()

def verify(folder, hashes):
    for filename, expected in hashes.items():
        assert sha(folder / filename) == expected, f'Source seal mismatch: {folder / filename}'

def seal(folder, files):
    PENDING[folder / 'SHA256SUMS'] = ''.join(f'{hashlib.sha256(PENDING[folder / f]).hexdigest()}  {f}\n' for f in files).encode()

# These are the immutable compact deliverables, independently sealed here before projection.
inputs = {
 '03-busy-input-calls/evidence/common-2tick-inputs.json': '00782dda5729b80fe905308bf9be4bcd8c658c4ab711b7d864b13fabb791e0c0',
 '04-source-search/mechanics.json': '94504d82f177aecedd3687db1c882d0023d407065d26ee716ea87db68b268f4f',
 '06-circuit-evaluation/evidence/validation.json': '729c24561bdee3a4dead6d867d63549177de56ad8f75474adfcff474181d3ef9',
 '06-circuit-evaluation/evidence/events.json': 'ee173a32fbba1b375e3b6346999d1be1fd53f793abcf31f24955d4eb98992282',
 '06-circuit-evaluation/evidence/visible-window.json': 'a882875067f42595cd5aa4e1ace3323b45ac8ca9a40e889e0ef8d7248210d4cf',
}
verify(SOURCE, inputs)

RI3_SEALS = {
 "03-busy-input-calls/.scratch/real-8tick-02/calls.jsonl": "7b5a14d1460cf18082ff17e5f0cab260f5f2700599ac1b5652c927aeabc366c0",
 "03-busy-input-calls/.scratch/real-8tick-02/SHA256.json": "3b072682c40deca1f8b7ec39161bcf2d6c50a618642bda55680d342c2f9cb744",
 "03-busy-input-calls/.scratch/real-8tick-02/reference-equality.json": "0dd1c1b22a08cde212266d623a15174922f8ae2b507a94b69e801210d055877c",
 "03-busy-input-calls/.scratch/control-2tick-02/calls.jsonl": "0ae400d740f1a760f8ff1f04f501e5d907f2c742d236a6ea7c29a1ae99e07791",
 "03-busy-input-calls/.scratch/control-2tick-02/SHA256.json": "a5b58bc5dd7f1413b7ccd71083a0d6d9127e549ef8f582302177b812956bc944",
 "03-busy-input-calls/.scratch/control-2tick-02/reference-equality.json": "305b0aef649678f2245b04934b2d03b76ea77529d721775802c43e3dd04e4adf"
}

# RI3's compact projection predates embedded provenance; pin its accepted raw seals explicitly.
verify(SOURCE, RI3_SEALS)
busy = SOURCE / '03-busy-input-calls'
bd = DEST / 'busy-input/fixtures'
bd.mkdir(parents=True, exist_ok=True)
projection = read(busy / 'evidence/common-2tick-inputs.json')
provenance = {}
for case in projection['cases'].values():
    run = busy / '.scratch' / case['capture']
    for name in ['calls.jsonl', 'SHA256.json', 'reference-equality.json']:
        p = run / name
        provenance[str(p.relative_to(busy))] = sha(p)
    assert read(run / 'reference-equality.json')['pass']
projection['source_hashes'] = provenance
projection['source_compact_sha256'] = inputs['03-busy-input-calls/evidence/common-2tick-inputs.json']
projection['version'] = '2.1.21'
projection['binary_sha256'] = '64a4dbc1a6de1e2556efd627f543d6072eaca6e69ee8b0c26df358bbd559adf7'
projection['limits'] = ['Two common ticks only; real and control layouts differ. No full-period rate or price inference.',
    'Observer fullness calls are excluded; status is not scheduler membership. Alarm return was not intercepted.',
    'Zero filter/canInsert calls apply only to selected intercepted paths, not all possible inlined source work.']
write(bd / 'observations.json', projection)
seal(bd, ['observations.json'])

source = SOURCE / '04-source-search'
sd = DEST / 'source-search/fixtures'
sd.mkdir(parents=True, exist_ok=True)
projection = read(source / 'mechanics.json')
verify(source, projection['provenance'])
manifest = read(source / '.scratch/capture02/SHA256.json')
for local in ['scripts/probe.lua', 'scripts/observe.py', 'scripts/code-sites.json']:
    expected = [value for key, value in manifest.items() if key.endswith('/04-source-search/' + local)]
    assert len(expected) == 1 and sha(source / local) == expected[0], f'Source input seal mismatch: {local}'
write(sd / 'observations.json', projection)
PENDING[sd / 'scaffold.txt'] = (source / '.scratch/reference02/scaffold.txt').read_bytes()
# The captured scenario is retained with only an explicit opt-in pause at its debugger gate.
probe = (source / 'scripts/probe.lua').read_text().replace('if t==1 and not paused then', 'if options.pause_at_gate and t==1 and not paused then')
PENDING[sd / 'probe.lua'] = probe.encode()
write(sd / 'provenance.json', {'source': '04-source-search', 'compact_sha256': inputs['04-source-search/mechanics.json'],
 'source_probe_sha256': sha(source / 'scripts/probe.lua'), 'probe_change': 'Debugger pause is opt-in options.pause_at_gate; scenario observations/interventions unchanged.',
 'raw_hashes': projection['provenance']})
seal(sd, ['observations.json', 'scaffold.txt', 'probe.lua', 'provenance.json'])

source = SOURCE / '06-circuit-evaluation'
cd = DEST / 'circuit-evaluation/fixtures'
cd.mkdir(parents=True, exist_ok=True)
validation = read(source / 'evidence/validation.json')
verify(source, validation['hashes'])
for name in ['validation', 'events', 'visible-window']:
    write(cd / (name + '.json'), read(source / 'evidence' / (name + '.json')))
PENDING[cd / 'scaffold.txt'] = (source / '.scratch/reference02/scaffold.txt').read_bytes()
probe = (source / 'scripts/probe.lua').read_text().replace('if t==5 and not paused then', 'if options.pause_at_gate and t==5 and not paused then')
PENDING[cd / 'probe.lua'] = probe.encode()
manifest = read(source / '.scratch/capture04/SHA256.json')
reference_manifest = read(source / '.scratch/reference02/SHA256.json')
for suffix, local in [('scripts/probe.lua', 'scripts/probe.lua'), ('scripts/observe.py', 'scripts/observe.py'),
                      ('scripts/code-sites.json', 'scripts/code-sites.json'), ('.scratch/reference02/scaffold.txt', '.scratch/reference02/scaffold.txt')]:
    selected_manifest = reference_manifest if suffix.endswith('scaffold.txt') else manifest
    expected = [value for key, value in selected_manifest.items() if key.endswith('/06-circuit-evaluation/' + suffix)]
    assert len(expected) == 1 and sha(source / local) == expected[0], f'Source input seal mismatch: {local}'
config = read(source / '.scratch/capture04/config.json')
raw = [json.loads(x) for x in (source / '.scratch/capture04/calls.jsonl').read_text().splitlines()]
controls = []
for spec in config['control_specs']:
    matches = [e for e in raw if e['kind'] == 'control' and e['unit'] == spec['unit']]
    types = [e for e in raw if e['kind'] == 'control_type' and e['unit'] == spec['unit']]
    assert matches and types and all(e['type'] == spec['type'] for e in matches + types)
    vtable = int(matches[0]['vtable'], 16) - config['base']
    assert vtable == config['vtables'][{3:'inserter',9:'decider',10:'arithmetic'}[spec['type']]]
    controls.append({**spec, 'vtable_offset': hex(vtable), 'typed_getter_and_native_type_verified': True})
write(cd / 'native-mapping.json', {'controls': controls, 'entity_count': len(config['selected_units']),
    'arithmetic_update': {'entry': '0x34a10c0', 'receiver_adjustment': 24, 'parent_entry': '0x34a0e70',
       'note': 'Positively observed compiler-duplicated non-virtual thunk; unused parent entry is not a zero-update count.'},
    'decider_conditions': {'stride': 32, 'begin_offset': '0x2f0', 'end_offset': '0x2f8'},
    'generic_condition': {'typed_control_field_offset': '0x1bc', 'probe_calls_excluded': 19}})
# Derive role positions from the exact captured blueprint, preserving its entity-number namespace.
blueprint = json.loads(zlib.decompress(base64.b64decode(PENDING[cd / 'scaffold.txt'].decode().strip()[1:])))['blueprint']
role_names = ['source','sink','hand','fixed_generator','counter','positive_generator']
role_names += [net+'_'+kind for net in ['fixed','changing'] for kind in ['arithmetic_zero','simple_true','and_true','and_false_first','and_false_last','or_true_first','or_true_last']]
role_names += ['clock_relay']
layout = [{'role': role, 'name': entity['name'], 'position': entity['position']} for role, entity in zip(role_names, blueprint['entities'])]
layout.append({'role':'power','name':'electric-energy-interface','position':blueprint['entities'][-1]['position']})
write(cd / 'layout.json', layout)
write(cd / 'provenance.json', {'source': '06-circuit-evaluation', 'compact_source_hashes': {k:v for k,v in inputs.items() if k.startswith('06-')},
 'raw_hashes': validation['hashes'], 'scaffold_sha256': sha(source / '.scratch/reference02/scaffold.txt'),
 'source_probe_sha256': sha(source / 'scripts/probe.lua'),
 'code_sites_sha256': sha(source / 'scripts/code-sites.json'), 'observer_sha256': sha(source / 'scripts/observe.py'),
 'probe_change': 'Debugger pause is opt-in options.pause_at_gate; scenario observations/interventions unchanged.',
 'tick_origin': validation['reference_comparison'], 'repeat_scope': validation['event_comparison']})
seal(cd, ['validation.json','events.json','visible-window.json','native-mapping.json','layout.json','provenance.json','scaffold.txt','probe.lua'])
# Commit outputs only after every source, ABI and identity check has succeeded.
for filename, content in PENDING.items():
    filename.write_bytes(content)
print('Projected sealed RI3/RI4/RI6 compact observations; no native acquisition.')
