# Accumulators

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `accumulator-640` | abucnasty | abucnasty's build of nine copies (2026-11-10), 320 a second, as the scaffold; before it the config and scaffold of issue 152 (640 a second over 18 copies) | #152 | On the build of nine copies (`copies: 9`, Factorio 2.1.24): each copy moved 576 in each of the 3 window cycles of 972 ticks checked, each line 2,592. On the scaffold of issue 152: the clock 0.9.0 selected made 512 to 544 of 576 a window cycle; the observed windows clock 0.9.1 selected made 576 in each of 58 window cycles after 3 at 544 while it settled (60,264 ticks). Since even hands (2026-10-14) the recommended clock is that: 576 in each of 46 window cycles after the game test's settling of 7,200 ticks, no difference from the simulator. Note: in `test:game`; see the section on this build in the [samples README](../../README.md). |
