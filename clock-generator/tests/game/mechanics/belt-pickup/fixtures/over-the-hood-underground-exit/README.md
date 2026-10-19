# Over-the-hood underground-exit pickup

The exact user-supplied 58-entity [scaffold](scaffold.txt) places the input one tile **upstream** of an eastbound
exit, facing east. Its hand reaches across the hood into the exposed outlet; its body leaves the eastward belt
continuation free. This is distinct from the existing downstream-facing [front exit](../front-underground-exit/README.md),
whose inserter blocks the continuation. It does not fill that separate continuously-moving coverage row.

## Layouts and native coverage

The supplied plant layout is unchanged at turbo/express/fast. Its seven-tile source pair cannot connect at
normal speed. The separate [compact normal control](compact-normal-scaffold.txt) uses a legendary 3×3 assembler
centered at `(-106.5,428.5)`, making electronic circuits from iron plates/copper cable. It preserves exit39,
input36 and output31; entrance21 moves two tiles east to `(-108.5,428.5)`, with ordinary belts bridging its former
tile and the next. The incompatible five-module plant loadout is removed; native compact crafting speed with
retained beacons is **70.765625**, versus **109.475** for the plant. The supplied test configs match these values.
The compact layout is tested at every speed, making the speed comparison independent of the destination change.

| Layout | Turbo | Express | Fast | Normal |
| --- | --- | --- | --- | --- |
| Exact plant geometry | 12 tested | 12 tested | 12 tested | Skipped: tunnel exceeds range |
| Compact geometry | 12 tested | 12 tested | 12 tested | 12 tested |

Each set of 12 covers both mirroring states × moving/backed-up supply × original/swapped/same-item lanes:
**84 native first-hand controls**. All 36 shared plant/compact variants agree in first-grab timing, lane sequence,
phase and replay results; only recipe/item/hardware metadata differs. Two earlier setup pilots are retained
separately and do not add matrix coverage.

The target stays circuit-disabled through tick64 after **1,600 ticks of natural supply saturation**. No held or
belt stock is seeded, and machine inventories are cleared only once before observations. Guards check actual
pickup/drop targets, mirrored state, legendary hand16, recipe/hardware, ingredient pairs and tier prototypes,
two full four-item exposed stacks per lane, and native moving phase versus jammed stock. Compact output source
and product-drop targets are independently checked. The exact base's product output35 is an unpaired turning
stub; pairing checks deliberately cover the three ingredient pairs, not every decorative/product endpoint.

## Measured first hands

Offsets begin with the first grab; total ticks include both first and last grab ticks. These are the measured
aligned-lane phase at gate64, not every starting phase or an absolute arm-arrival model.

| Speed | Moving | Different items: offsets | Total pickup ticks | Same item: offsets / total |
| --- | --- | --- | --- | --- |
| Turbo | true | `0,1,3,5` | 6 | `0,1,2,3` / 4 |
| Express | true | `0,1,3,6` | 7 | `0,1,2,3` / 4 |
| Fast | true | `0,1,2,6` | 7 | `0,1,2,3` / 4 |
| Normal | true | `0,1,4,12` | 13 | `0,1,2,3` / 4 |
| Turbo / express | false | `0,1,2,3` | 4 | `0,1,2,3` / 4 |
| Fast | false | `0,1,2,5` | 6 | `0,1,2,3` / 4 |
| Normal | false | `0,1,2,9` | 10 | `0,1,2,3` / 4 |

Unmirrored hands prefer **lane1**; mirrored hands prefer **lane2**, preserved by ingredient swaps. Hand
coordinates and native unique-ID withdrawal independently establish every selected lane, including same-item
fallback. Moving same-item sequences are `PPFP` at turbo/express, `PPPF` at fast, and `PPFF` at normal;
backed-up sequences are `PPPP` at turbo/express and `PPPF` at fast/normal (`P` preferred, `F` fallback).
All exposed lines are half a tile; source internal lines3/4 remain empty in these captures.

The independent moving-stock replay agrees on all **42 moving first hands**; the experimental finite jammed
queue agrees on all **42 backed-up first hands**. Both condition on observed first grab/stock and do not prove
absolute approach timing. The engine's simpler backed-up approximation still lacks the fast/normal finite-refill
waits. No simulator or Sidecar implementation changes are included here.

Sidecar retains **unsupported / inline**, warning for the captured input and omitting `near_lane`/`pickup_length`.
The [frozen baseline](expectations.json) keeps native timing, physical lane selection and replay results separate
from that support boundary. These are isolated first hands; repeated operating throughput, interruptions,
independent lane alignment and a full gate-release phase sweep remain untested for this orientation.

## Evidence and reproduction

Final evidence is retained locally under `work/belt-speed-coverage/over-hood-base-02/`; `over-hood-base-01/`
contains the two setup pilots, and `inline-exit-pilot-01/` the original ungated orientation pilot. The first native
matrix pass had 12 host-assertion failures in express moving cases: an incoming stack entered the exposed
window and was grabbed in the same tick, while the prior visible tail remained. The observer now tracks both
endpoints' real IDs. An independent audit confirms all **336 grabs** (including 170 incoming-stack witnesses).
All 84 retained controls pass without recapturing native data or changing measured behavior.

```bash
# Native matrix; use a fresh retained directory.
BELT_SPEED_CAPTURE_DIR=../work/belt-speed-coverage/over-hood-new npm run test:game -- tests/game/mechanics/belt-pickup/over-the-hood-underground-exit.game.test.ts

# Frozen evidence replay: no Factorio process starts.
OVER_HOOD_REPLAY_DIR=../work/belt-speed-coverage/over-hood-base-02 npm run test:game -- tests/game/mechanics/belt-pickup/over-the-hood-underground-exit.game.test.ts
```

Both layout screenshots are registered but remain uncaptured while the user's graphical instance occupies one
process slot. The screenshot helper needs a headless server plus its own graphical client.
