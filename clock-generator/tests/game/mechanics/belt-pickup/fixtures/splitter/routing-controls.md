# Additional turbo splitter routing controls

These six independent tests use the [same supplied scaffold](scaffold.txt), [config](config.json) and
[shared probe](probe.lua). Each starts a fresh save/session, gates only the target through 1,200 natural
warm-up ticks, and observes 60 ticks after release. No belts or hands are seeded, and the machine is never
cleared. Priority and filter changes are applied to the blueprint before warm-up. Factorio: 2.1.21.

The existing [image](scaffold.jpg) illustrates the base layout. Derived layouts retain exact blueprints in
the raw capture directories; the original scaffold is not replaced.

## Changes and findings

| Independent control | Deliberate change from base | First hand | Prior-observation consumed lines |
| --- | --- | --- | --- |
| `left-priority` | Output priority right → left, toward the open north drain | No grabs in 60 ticks | None |
| `filter-cable` | Add copper-cable splitter filter, retain right priority | Cable: 2,3,4,5 | 8,2,8,2 |
| `filter-iron` | Add iron-plate splitter filter, retain right priority | Iron: 2,3,4,5 | 7,1,7,1 |
| `south-input` | Move only feeder entities #1–11 south by one tile, preserving their directions/mirroring | Iron: 2,3,4,5 | 7,3,7,3 |
| `north-port` | Reflect all entity Y positions about splitter center and swap north/south directions; target remains unmirrored; use left priority for the new north pickup port | Cable: 2,3,4,5 | 5,3,5,3 |
| `north-port-mirrored` | From `north-port`, change only target #14's mirroring to true | Iron: 2,3,4,5 | 6,4,6,4 |

The north-port transformation retains feeder mirroring rather than claiming a pure reflection of every
handed component. Native metadata and initial stock are asserted, so its ingredient arrangement is explicit:
cable occupies line 5 and iron occupies line 6. The dedicated mirror control changes only target mirroring.
The feeder-side control changes which input lines supply replacement stacks, without changing the preferred
output line or any observed hand timing from the original baseline.

**Availability precedes ingredient preference.** With left priority toward the continuously draining north
outlet, the south pickup lines start empty and the inserter never grabs. With a splitter filter, only that
ingredient reaches the south output. The unmirrored inserter takes cable on line 8 when line 7 is empty;
the earlier preference for line 7 is not an unconditional preference for iron or a reason to ignore available cable.
On the north port it prefers line 5 unmirrored and line 6 mirrored when both ingredients are present. This
extends the local odd/even output-line observation to the two measured eastbound ports, not every orientation.

**Filtering changes supply; machine limits still govern collection.** Cable-filtered hands grab at 2,3,4,5;
13,14,15,16; and 24,25,26,27. Iron-filtered supply gives one iron hand at 2,3,4,5. At tick 60 the native machine
holds cable 48 or iron 16 respectively, above the engine's existing insertion limits. Stock remains available
at the pickup while the empty-handed inserter stops collecting. The test checks the existing machine-limit
classification; these stops do not require a new pickup timing delay.

**Geometry does not remove the later replenishment pause.** The south-input control reproduces every original
hand: iron at 2,3,4,5; cable at 13,14,15,17, 25,26,27,29 and 37,38,39,41; iron at 49,50,51,53. The north-port
unmirrored control instead starts with three cable hands at 2,3,4,5, 13,14,15,17 and 25,26,27,29, then iron
at 37,38,39,41. Mirroring that target restores the original item/tick sequence. Machine buffering explains
why changing the initially selected ingredient changes the later hand sequence; there is no universal recipe order.

The ID traces account for stacks routed into the observed downstream underground, so transfers are not
counted as grabs. A stack last observed on an input line may be routed and consumed between samples;
these observations do not establish direct inserter access to splitter input lines.

## Simulator decision

The useful general rules remain simple: choose an eligible ingredient from reachable stock, use the measured
local lane preference when both are available, keep collecting the same item, and recheck machine eligibility
at every grab. Replenishment is a separate supply/routing problem.

The ordinary-belt model cannot predict splitter arbitration, output filtering or finite stock shared across
ports/consumers. The serial blocked-drain case also disproves treating every closed-outlet network as infinite
backed-up supply. These controls justify retaining Sidecar's `splitter` warning and omitting geometry/preferred
lane, rather than assigning a fixed delay or silently claiming support. All scheduled splitter controls are
now measured; a complete splitter simulation would be a separate expansion of scope requiring a finite routing
model and additional arbitration calibration.

## Reproduce and evidence

From `clock-generator/`:

```bash
# Choose exactly one new control during investigation.
SPLITTER_ROUTING_CAPTURE_DIR=../work/belt-pickup/splitter-routing-new-run npm run test:game -- tests/game/mechanics/belt-pickup/splitter-routing.game.test.ts -t 'north-port-mirrored$'

# Regression after the controls have been individually evaluated.
npm run test:game -- tests/game/mechanics/belt-pickup/splitter-routing.game.test.ts tests/game/mechanics/belt-pickup/splitter.game.test.ts
```

The six new controls and six earlier controls pass independently in the affected regression run. New native
reports, exact blueprints and generated probes are retained under ignored `work/belt-pickup/splitter-routing-final/`.
[Compact expectations](routing-expectations.json) retain measured initial stock, every hand's item/grab ticks,
and first-hand ID origin lines; they contain no session-dependent native IDs. Every test independently asserts
the Sidecar unsupported warning and omitted geometry/lane preference. Simulator comparisons remain separate
from the shared capture helper.
