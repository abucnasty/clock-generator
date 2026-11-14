# Belt lane recording

`belt-lanes.game.test.ts` records the automation-science build and checks drop-lane identity, occupancy and room
at each tick. `near-lane.game.test.ts` uses the utility science 480 build, where two belts carry processing units and robot
frames on opposite lanes. Their inserters must retain the processing-unit lane associated with their own belt.

## Scaffolds

The drop-lane recording uses the scaffold of the [automation science 240 build](../../../../resources/config-samples/science/automation/automation-240.scaffold).

That scaffold is shared with the clock-wiring test.

The opposite-lane check uses the scaffold of the [utility science 480 build](../../../../resources/config-samples/science/utility/utility-480-lds-foundry-chain.scaffold).

That scaffold is reused from the real-build samples.

From `clock-generator/`, run just the desired check:

```bash
npm run test:game -- tests/game/mechanics/belt-lanes/belt-lanes.game.test.ts
npm run test:game -- tests/game/mechanics/belt-lanes/near-lane.game.test.ts
```
