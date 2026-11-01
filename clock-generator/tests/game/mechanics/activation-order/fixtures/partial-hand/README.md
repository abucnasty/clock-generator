# Partial machine-source notifications

The [scaffold](scaffold.txt) is an exact copy of the measured three-cell input. Each AM3 makes copper cable,
a legendary stack inserter has a 16-item override, and a 48-slot steel chest accepts output. The source outputs
receive 0/8/16 cable before the capture; held stock is never injected. One real craft is triggered after visible 8
by one copper plate and progress0.99. Direct output insertion of 8 after visible 14 is a separate intervention.
The scaffold's disconnected inherited condition setter was ineffective: findings apply to the observed effectively
enabled baseline, without any condition-write inference. The native layout image below shows the warmed scaffold without probe stock/interventions.

![Native three-cell source notification layout](scaffold.jpg)

The [generated provenance](../../../screenshots.generated.json) records the exact scaffold hash, Factorio version and capture recipe.

`observations.json` preserves 46 paired native observations:20 Updates,14 Alarms,6 Activations and6 directly
intercepted Deactivations. Partial hands deactivate after top-up; a full 16 hand stays active to swing. The original
full 16 hand had already delivered before source event 8. Source craft 8 attaches hand3→2→1; next Updates at 9 are1→2→3.
Direct insertion at 14 attaches1→2→3; Updates at 14 reverse3→2→1. Normalized links retain a shared unmapped anchor;
its unverified type/ownership is not inferred. Native units are evidence identities only.

Reference/capture01 have raw 24-row equality. Capture 02's absolute start is one tick earlier: raw equality is
false and remains recorded; explicitly declared origin-relative visible equality and address-free event equality
are true. Do not describe the second comparison as raw equality. Actual tick k transfers appear in visible k+1.

The [source exporter](../../../../../../scripts/scheduler/project-notification-fixtures.py) retains the frozen source
projection hash, original binary/staging/input/script/observer hashes, native roles, before/after membership,
caller and raw sequence/return sequence, exact topology, comparison limits and scaffold hash. SHA256SUMS seals
fixture and scaffold. Full recordings/probes remain in the 0.26.0 RI5 evidence package, not this fixture directory.

The nearby simulator regression supplies observed notification eligibility, native membership outcomes and
phase boundaries to ActiveScheduler, then reproduces the exact event/order sequence. It does not yet derive
hand/craft/control physics or claim a production fix. Run from clock-generator:

```bash
npm test -- src/simulation/active-scheduler-notifications.test.ts
```

## Derived source and hand outcomes

`src/simulation/inserter-scheduling-native.test.ts` also runs the production machine/hand notification components.
Source stock0/8/16 establishes carry through real setup pickups; a real plate/progress intervention makes2cable at8,
and a separately labelled live insertion adds8at14. No native membership or activation outcome is supplied. The
component matches all24visible rows and each hand's Alarm/Activation/direct-Deactivation/Update sequence. The sink's
single-item capacity is4800, equivalent to the measured empty48-slot chest for this cable-only, non-full interval.

This comparison deliberately does not force global cross-cell traversal order: native craft and direct insertion
visit these independent cells in opposite orders. Registration order is a simulator scenario, not a universal native
list policy. It also does not infer a condition-write rule from this disconnected/effectively enabled baseline.

Default World dispatch remains unchanged. A broader active-World trial passed this fixture but contradicted existing
native cold-start belt calibrations, so it was isolated and stopped without changing those assertions. These source
hooks and derived outcomes are an integration prerequisite, not a full agricultural/three-copy or timing fix.
