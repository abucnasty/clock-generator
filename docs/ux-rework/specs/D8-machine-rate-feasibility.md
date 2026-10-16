# D8 Per-machine production rates — approved Phase 4 investigation

Owner approval, 2026-10-16: A / A / A. Phase 4 targets `feat/ux-rework`. This item authorizes semantic definition and feasibility investigation only. Engine/UI implementation and the new display require a subsequent owner decision on the resulting proposal.

## Intended rate contract

- Planned: read-only, authoritative engine-derived output demand assigned to an individual machine by the requested build output and connected topology. This is not a new editable per-machine goal.
- Maximum: the individual machine's attainable intrinsic capacity.
- Achieved: the individual machine's simulated output under the selected clock, where authoritative data is available.
- Each machine's figures describe that machine in one modeled unit. If totals across Copies are shown later, label them separately and preserve fractional-Copies semantics.

## Investigation and deliverable

- Inspect current cycle/transfer planning and serialized machine facts. Establish whether per-machine demand already exists, whether allocation is unique/meaningful, and what would need exposing through engine/worker/UI boundaries.
- Determine availability after Check versus Generate, validity after edits and behavior for stale, unknown, ambiguous or infeasible data. Do not infer intermediate demand by copying final-output demand or scaling intrinsic maxima in UI code.
- Work through representative simple chains, multiple producers/output items, productivity/by-products and fractional/below-target cases. Account for loops and fuel/fluid boundaries where relevant; distinguish measured source facts from assumptions or unresolved cases.
- Deliver a concise semantic contract with source authority, units, lifecycle and worked fixtures, plus implementation options, affected boundaries, risks and effort. Separate a display-only use of existing data from any new planning/serialization work.
- Present the implementation proposal to the owner before implementing the feature. No product/schema/cache changes or new dependencies are authorized by this investigation-only approval.
- Current verification, independent reviews and the three phase-end reviewers remain required. This investigation does not relax existing exact arithmetic or freshness contracts.
