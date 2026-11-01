# Condition-assignment notifications

The [scaffold](scaffold.txt) is an exact copy of the measured six-cell input. Each AM3 copper-cable source feeds
a legendary 16-item inserter and empty 48-slot steel chest. The probe connects each hand to its own zero-signal
green chest network and validates flat condition assignments by immediate readback. The scaffold alone does
not contain that probe-created wiring or its stock/interventions. The native layout image below shows the warmed scaffold without probe stock/interventions.

Cells 1–3 begin with 8 source cable, 4–6 with 16; no held stock is injected. A 1/4 receives false writes after visible 5/12,
true after 9/14. B 2/5 receives an equivalent-true predicate after 5; C 3/6 gets no writes. One actual craft per source
follows visible 7. These operations change existing conditions, not entity/control objects or physical clocks.

![Native six-cell condition assignment layout](scaffold.jpg)

The [generated provenance](../../../screenshots.generated.json) records the exact scaffold hash, Factorio version and capture recipe.

`observations.json` preserves 26 Alarms,15 actual Activations,21 direct Deactivations and42 Updates. An equivalent-true
write can alarm and attach an inactive partial hand. A source Alarm can attach disabled A, whose Update then
sleeps without pickup. On re-enable at 9, setter→Update→deactivate precedes a distinct control finish-dispatch Alarm;
next Update at 10 takes 2, visible 11. Observed native phase order is supplied to replay; hidden pending/cache state is
not decoded. Original16 hands had already delivered before disable, so no full carried-hand edge is claimed.

Both fresh captures equal the full 24-row reference and repeat 307 ordered raw call/return events after declared
process normalization. No absolute origin shift occurred. The selected event pairs retain entry/return indices,
caller, native unit/roles and membership. Source binary/staging/config/scaffold/script/observer/raw-record hashes
and validation scope remain in the fixture. SHA256SUMS seals compact observations and captured scaffold.
Full recordings/probes remain in the 0.26.0 RI2 evidence package.

The [source exporter](../../../../../../scripts/scheduler/project-notification-fixtures.py) projects the repeated
native evidence. Scheduling replay reproduces the selected event/order sequence after receiving observed
phase boundaries and membership outcomes. Native visible carry/control fields are context; this is not a
World/useControls integration or physics prediction. Run from clock-generator:

```bash
npm test -- src/simulation/active-scheduler-notifications.test.ts
```
