# Observed alarm, wake, sleep and update order

These bounded Factorio 2.1.21 observations exercise a local scheduler primitive. The replay supplies observed
notifications and wake/sleep outcomes. It does not derive the factory's hand, machine or circuit behavior.

The agricultural cases were recorded on one copy of the agricultural science build, the sample's scaffold until it moved to
abucnasty's build of five copies; that copy is kept as the staged-start tests' [fixture](../staged-start/fixtures/agricultural-science-one-copy.scaffold).

The low density structure case reuses its existing scaffold with a diagnostic clock: the exact historical clock is
unavailable. See the [game evidence guide](../../README.md).

| Case | Ticks | Observed behavior |
| --- | --- | --- |
| agricultural | 4836–4838 | Consumption wakes egg A then B; next updates are B, A, output. An output take wakes waiting inputs again. |
| agricultural-belt | 4836–4838 | Belt input wakes after B; next updates are belt, B, A, output. Its first stack is visible in row 4839. |
| lds-diagnostic | 5629–5630 | Consumption wakes input, then a control change wakes output; next updates are output, input. Transfers appear in row 5631. |

An alarm is a delivered notification; it does not always cause a wake or reorder an inserter on the update list. The original
sleep transitions are inferred between observations. Both bounds remain in each fixture; the replay applies sleep
only at the final observation in sleep and does not invent an exact sleep time. Later directly observed sleep events
in the [partial-hand](fixtures/partial-hand/README.md) and [condition-assignment](fixtures/condition-writes/README.md)
cases do not upgrade those older intervals.

The fixtures retain exact role/update order, visible inventories and held quantities, the declared tick origin and
comparison limits. Transfers in actual tick k appear in visible row k+1. SHA256SUMS seals the public fixture bytes.
The scheduling events are separate from priced wake counters. These short observations do not establish a universal
subscriber or worker order, complete initial state, every eligibility cause, control replacement equivalence or a
full agricultural production fix. No quantity, recovery requirement or native clock pin is changed.

Run from clock-generator:

```bash
npm test -- src/simulation/active-scheduler.test.ts src/simulation/active-scheduler-native.test.ts src/simulation/active-scheduler-notifications.test.ts
```
