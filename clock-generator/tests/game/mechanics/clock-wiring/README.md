# Clock wiring

This test gives every inserter in the automation-science scaffold an inherited circuit condition that the new
clock never sends. The harness must replace those conditions and wire the generated clock so production meets
its target. The source scaffold is shared with the belt drop-lane recording test.

The test uses the scaffold of the [automation science 240 build](../../../../resources/config-samples/science/automation/automation-240.scaffold).

The test generates and attaches its clock at runtime.

From `clock-generator/`:

```bash
npm run test:game -- tests/game/mechanics/clock-wiring/clock-wiring.game.test.ts
```
