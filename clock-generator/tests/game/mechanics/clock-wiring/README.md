# Clock wiring

This test gives every inserter in the automation-science scaffold an inherited circuit condition that the new
clock never sends. The harness must replace those conditions and wire the generated clock so production meets
its target. The source scaffold is shared with the belt drop-lane recording test.

![Automation-science base scaffold used by the clock-wiring test](../images/automation-science.jpg)

The [source blueprint](../../../../resources/config-samples/science/automation-science/automation-science-scaffold.txt)
is shown here after warm-up with its clock disabled. The test generates and attaches its clock at runtime; that
clock and the test's modified conditions are not shown in this base-layout image.
See the [screenshot guide](../../README.md#scaffold-screenshots).

From `clock-generator/`:

```bash
npm run test:game -- tests/game/mechanics/clock-wiring/clock-wiring.game.test.ts
```
