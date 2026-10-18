# Turbo splitter support work

The feature branch is `feature/turbo-splitter-support`. Small sub-PRs target that branch and merge after
their checks pass. The final feature PR stays draft until generator and capture support are verified.
Publishing remains on hold; engine/UI 0.19.0 and Sidecar 0.11.0 remain unreleased.

## Calibrated routing kernel

[`TurboSplitterSupply`](../src/state/turbo-splitter-supply.ts) models finite stock on the eight native lines
of the measured north-input, right-priority turbo splitter. The north output drains freely and the south
pickup port has no continuation. Only the north input is calibrated. Positions use 1/256 tile units and
four-item stacks; the class rejects uncalibrated input stock and invalid spacing.

The [fixture findings](../tests/game/mechanics/belt-pickup/fixtures/splitter/README.md#input-phase-output-admission-and-overflow-calibration)
describe the independently measured entry and follower-dependent overflow rules. A congested arrival also
slows to maintain spacing on the receiving input line. The three additional arrival controls establish that
landing at 178 is allowed, while a proposed 179 remains upstream. The native reports assert actual seeded
positions, then compare all eight lines continuously; they do not reset predictions to observed internal stock.

The same kernel serves the naturally supplied 60-transition baseline and the seeded calibrations. Accepted
arrival IDs and departing stacks expose conservation boundaries. Pickup methods remove one finite stack,
retain partial stacks, and respect the preferred lane. Stock positions/items/counts enter its repeat key;
observation IDs do not. Snapshots are independent copies.

This kernel does **not** yet establish generator support: its feeders and withdrawals are external boundaries.
The native replay supplies previous upstream observations and measured grab events. Production pickup
selection, feeder queues and clock timing must replace those boundary observations before support is enabled.
Sidecar therefore still exports unsupported splitter captures.

## Next integration gates

1. Own feeder queues in simulation state and advance the shared supply exactly once per tick, including while
   inserter windows are closed. Preserve queues, holes, partial stacks and phase through control replacement,
   snapshots and repeat detection. Model supply interruption/restoration without inventing finite stock.
2. Connect the existing inserter pickup logic to dynamic available items and finite withdrawals. Keep machine
   eligibility, held-item collection and one-stack-per-tick behavior in the inserter; routing owns availability.
   Verify full repeated-hand traces without observed grab times as simulator inputs.
3. Define the narrow positive config/capture model. Retain physical component and pickup-port identities
   separately from logical belt IDs. Sidecar must positively identify required feeders, priority and downstream
   boundaries; ambiguous layouts stay unsupported. Previously saved captures require recapture.
4. Generate a clock for the supported scaffold and verify per-period output, startup assumptions and supply-loss
   recovery in Factorio. Only then enable that layout in capture/UI and describe it as generator-supported.
5. Expand independently through ingredient swaps/mirroring, other measured ports/approaches, unset/opposite
   priorities, filters, blocked outlets and serial splitters. Each expansion must reproduce native stock and
   hand traces, then its generated-clock checks. Do not infer permanent local saturation from a blocked final drain.

Remain on turbo belts and the measured stack capacity during this series. Express merges, other speeds,
uncalibrated orientations and full transport-network simulation are separate scope decisions.
