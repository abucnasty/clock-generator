/**
 * The container fixtures (`container-clock-fixtures.ts`) whose clock the generation test still generates end to end;
 * the other four of the six are checked without generating, by container-clock-mechanics.test.ts (slots and stock in the
 * simulator, the cut lengths and the recorded controls). The generated clock depends on the recipe and the rate, not on
 * the container: the three gear fixtures share one clock hash and the three circuit fixtures another (container-clock-controls.json),
 * so each recipe is generated once. Each is the one case of a path through the generator that no sample takes:
 */
export const CONTAINER_GENERATED: ReadonlyMap<string, string> = new Map([
    ["container-wagon-normal", "one input from a container between two inserters, the planned-belt-slack clock, where even-hands ties it with no wake-ups and is still made (a cargo wagon of 40 slots, none filtered)"],
    ["container-car-mixed", "two inputs mixed in one container by slot filters, the planned-belt-slack clock (a car of 80 slots)"],
]);
