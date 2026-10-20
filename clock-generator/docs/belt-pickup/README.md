# Belt pickup documentation

- [Timing reference](timing.md): layout diagrams, measured grab ticks and total pickup time.
- [Diagram glossary](glossary.md): side pickups, front approaches, through supply and test conditions.
- [Experiment findings](experiments.md): coverage, measured patterns and simulator disagreements.
- [Capture and configuration](capture.md): Sidecar provenance, supported models and saved-data handling.

The [simulator guide](../simulator.md#picking-up-from-moving-belts-and-underground-endpoints) describes implemented
behavior. The [mechanics fixtures](../../tests/game/mechanics/belt-pickup/README.md) provide screenshots and
reproduction instructions. **Side-loaded pickup tiles, merges and splitters are out of scope**; see the
[experiment history](experiments.md#side-loaded-pickups-and-merges). Publishing remains on hold.

## Simulation diagnostics

A simulation context can observe one inserter without changing its physical state or repeat detection:

```ts
const trace = context.traceInserter(2, {
    start_tick: 64,
    end_tick: 256,
    max_events: 2000,
});
// Run the existing simulation or targeted replay with this context.
const events = trace.events;
const incomplete = trace.truncated;
```

Events include mode changes, pickups/drops, physical pickup-lane selection and the wait reasons reported by
belt-transfer decisions. Ticks use the context's provider; they are not offsets from the first grab. The
inclusive window and event cap bound retention. Truncation is explicit, and events outside the window do not
consume the cap. Replace the trace to start another capture, or delete `inserterState.trace` to detach it.

The observer remains attached when controls are replaced on the same state. Independent state clones omit it.
These events describe the current simulator, including its known limitations; they do not establish game parity.
Existing native clips and the experiment matrices remain the comparison evidence. No Pickup details UI is added.
