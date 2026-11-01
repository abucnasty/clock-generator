# Circuit changes and a carried hand

This Factorio 2.1.21 scenario compares fixed and changing inputs to arithmetic and decider combinators. Their visible
outputs stay equal: multiplication by zero stays zero, and the selected predicates stay true or false. A real inserter
picks up 16 copper cable before its destination is filled with 4800 iron plates. Its period-8 enable condition then
changes while the full hand remains carried. [The exact scaffold](fixtures/scaffold.txt), [layout](fixtures/layout.json)
and existing screenshot catalog entry describe the same physical cell.

![Circuit and carried-hand layout](fixtures/scaffold.jpg)

The observations retain 24 visible rows and a 20-tick condition/update window. Fixed and changing combinators still
receive 20 updates each; output/condition operations differ. The indexed AND/OR checks preserve their original
short-circuit order and boolean results. Constant-input arithmetic has no selected output computation, while the
changing-input case has 20. These are bounded observed operations, not a price or proof about every possible path.

The hand receives alarms at 8,16,24 and updates at 9,17, with two observed sleeps. It keeps the real 16-item hand and
never drops into the full destination. Enabled-condition checks distinguish 20 game actions from 19 induced by
observation. Those induced checks are excluded from game-action totals.

Repeated observations match exactly within each role after only each declared installation origin is subtracted from
absolute game ticks. Global interleaving across independent roles differs and is not a deterministic scheduling rule.
The fixture and tests preserve this distinction; reordered role groups are permitted, reordered events within one role
are not. Ordinary visible outputs alone do not establish condition-check counts.

The source-near hand test supplies only the observed enable stream and physical intervention, then derives pickup,
carry and refusal. It does not supply expected hand outcomes or scheduler membership. The ordinary game test retains
the same visible quantities, condition outputs, intervention and all period-8 values. SHA256SUMS seals the public files.

```bash
npm test -- src/harness/probe-observations.test.ts src/simulation/components/hand-native-carry.test.ts
```
