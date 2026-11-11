# Staged construction

The staged-start test uses the agricultural-science sample to check that ingredient lanes saturate before fresh
inserters of the build are put down in a single tick. It checks ascending and descending construction order, unit-number
order, empty machines, and the configured kick start of the loop. It does not infer startup timing from a screenshot.

The test builds the scaffold of the [agricultural science 250 build](../../../../resources/config-samples/science/agricultural/agricultural-250.scaffold).

That scaffold remains a shared general clock sample.

From `clock-generator/`:

```bash
npm run test:game -- tests/game/mechanics/staged-start/staged-start.game.test.ts
```
