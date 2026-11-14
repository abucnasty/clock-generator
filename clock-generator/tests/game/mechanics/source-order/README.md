# Shared-source order

This compact Mechanics fixture asks whether the robustness trial set includes one observed allocation in which
three machine sources exhaust their stock in different local orders. It reuses the real
[the utility science 480 build config](../../../../resources/config-samples/science/utility/utility-480-lds-foundry-chain.json) and
[scaffold](../../../../resources/config-samples/science/utility/utility-480-lds-foundry-chain.scaffold); no new scaffold is added.

The layout is the scaffold of the [utility science 480 build](../../../../resources/config-samples/science/utility/utility-480-lds-foundry-chain.scaffold).

## Recorded observation

[fixtures/independent-source-allocations.json](fixtures/independent-source-allocations.json) is a selected state cut
from `thaeln-output-cut-drops.json` on Factorio 2.1.21, with Space Age, legendary stack inserters and fully researched
hand capacity. The JSON retains source-recording and priority-derivation SHA-256 hashes, game tick 147865
(recording tick 4206), exact machine inventories/progress, and selected hands before and after pickup.

All six selected hands begin empty. Sources 3, 4 and 11 each contain 17 low-density structures. The visible next
row shows allocations 7:16/5:1, 6:16/8:1 and 26:16/23:1 respectively. Neither global ascending nor global descending
config-id order represents all three. Entity numbers identify this recording only; they are not native scheduling rules.
Other measured machine states are retained for hydration; source 10 is not an asserted simultaneous allocation.

A separate four-run native minimal pair isolates independent local priority: two foundries, two empty takers per
source, nine source items, no completed crafts and no hand injection. Reversing only source B's hand build order
changes B's winner from right to left; source A remains right. Lua condition writes stay in physical position order.
Fresh replicas agree. First positive held counts are visible in row 1; internal execution order is not asserted.
This supports independent priority sampling, not a universal activation policy or reproduction of the 17-item event.

Original evidence is retained in the 0.26.0 investigation package under
`planner/evidence/followups/` (full recording and `native-priority.json`) and
`planner/evidence/input-order/mixed/native-pair9-fixed/` (four raw runs, scripts, summary and SHA256.json).
Full raw recordings and generated probes are not duplicated into this compact fixture.

## Offline replay and limits

From `clock-generator/`:

```bash
npm test -- src/simulation/independent-takers.test.ts
```

The nearby simulator regression hydrates measured machine inventory/progress and replays only the selected local
pickup ports. It checks that the sampled trial set contains the observed allocation. It does not execute a whole
machine tick or launch Factorio, and does not claim a full pipeline, tunnel, upstream-supply or later-shortfall cure.
The new trial set preserves the previous global orders and adds changing one contested source at a time while
other sources remain descending. Higher-order joint combinations are not exhausted. No native timing assertion,
clock pin, recovery requirement, priced wake counter or timeout changes.
