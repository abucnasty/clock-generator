# Staged construction

The staged-start test uses the agricultural-science sample to check that ingredient lanes saturate before fresh
inserters of the build are put down in a single tick. It checks ascending and descending construction order, unit-number
order, empty machines, and the configured kick start of the loop. It does not infer startup timing from a screenshot.

The test builds one copy of the agricultural science build, its own fixture
([fixtures/agricultural-science-one-copy.scaffold](fixtures/agricultural-science-one-copy.scaffold)): the sample's scaffold
until the sample moved to abucnasty's build of five copies (2026-11-11). The taker-order test builds the same copy.

From `clock-generator/`:

```bash
npm run test:game -- tests/game/mechanics/staged-start/staged-start.game.test.ts
```
