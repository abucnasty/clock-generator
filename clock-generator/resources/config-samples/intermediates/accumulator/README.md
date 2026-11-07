# Accumulators

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `accumulator-640` | none recorded | issue 152, config and scaffold as the issue gives them | #152 | The clock 0.9.0 selected made 512 to 544 of 576 a window cycle; the observed windows clock 0.9.1 selected made 576 in each of 58 window cycles after 3 at 544 while it settled (60,264 ticks). Since even hands (2026-10-14) the recommended clock is that: 576 in each of 46 window cycles after the game test's settling of 7,200 ticks, no difference from the simulator. Note: in `test:game`; see the section on this build in the [samples README](../../README.md). |
