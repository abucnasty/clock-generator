# Busy-input selected call paths

This compact RI3 evidence compares the first **two ticks only** of repeated real-design8tick captures and repeated
control2tick captures in Factorio2.1.21. The real save is cell02-today, SHA256
`2b39a0e1f4aa945f95ea1eee7a48e876326577ac859212119fe21c91e1a6fe5f`; control save SHA256 is retained in the fixture.
These are unmatched original full-save layouts, not a controlled minimal pair. No new scaffold or substitute JPEG
is introduced. Exact original saves/raw references remain in the hashed research source package.

`GameFixturePaths.BUSY_INPUT_OBSERVATIONS` catalogs [observations.json](fixtures/observations.json).
All8 real and12 control selected input hands Update once per tick (16/24entries). The four refusing hands in each
layout run2Updates each and directly deactivate/reattach. The real refusal path has8fullness=true calls and no
selected source-filter/canInsert calls. Control has8fullness=false,8filter and8canInsert=false calls. The
[controlled RI4 complement](../source-search/README.md) isolates these gates and source-loop shapes.

Alarm totals8/16 differ from8actual attachments in each case. Some Alarms arrive on already-linked hands;
Alarm/Activation/Deactivation/Update cannot substitute for one another or for priced wake counters. Alarm entry
only was intercepted here; no Alarm-return state is invented. Source checks require verified selected Update
ownership; **12 observer-induced fullness calls per common slice** are explicitly excluded. Other selected hands
are already carrying/moving. Visible status does not determine active membership.

Selected call/return sequences, membership bits/self-links, caller chains, native units, per-case denominators,
original compact seal and raw capture/reference hashes remain in the projection. Full recordings/probes remain
ignored in the external research source. `SHA256SUMS` seals this intentional compact cut.

From `clock-generator/`:

```bash
npm test -- src/harness/probe-observations.test.ts
python3 scripts/mechanics/project-native-observations.py /path/to/release-investigations
```

CI reads stored native observations without Factorio/GDB. This checks evidence attribution and the bounded
path distinction; it does not derive native calls from simulator physics. Zero entries refer only to intercepted
methods/phases, not alternative/inlined work. Repeated real8tick/control2tick gates pass exact references; larger
control attempts exceeded the unchanged cap and remain rejected. No24/256tick-period denominator, whole-factory
cause, sharing/cost inference, price change, throughput proof or production fix follows from two unmatched ticks.
