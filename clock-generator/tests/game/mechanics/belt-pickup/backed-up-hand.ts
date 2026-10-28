import path from "path";
import { expect } from "vitest";
import { Config } from "../../../../src/config";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { EntityState } from "../../../../src/state";
import { GameFixturePaths } from "../../helpers/fixture-paths";

export const BACKED_UP_GEOMETRIES = ["straight-belt", "underground-entrance", "underground-exit"] as const;
export const BACKED_UP_ITEMS = ["accumulator", "supercapacitor"] as const;
export type BackedUpGeometry = typeof BACKED_UP_GEOMETRIES[number];

/** The different-items fixture with its input belt backed up, laid out as `geometry` and taking only `item` */
export async function backedUpPickupConfig(geometry: BackedUpGeometry, item: string): Promise<Config> {
    const config = await loadConfigFromFile(path.join(GameFixturePaths.DIFFERENT_ITEMS, "config.json"));
    config.overrides = { ...config.overrides, backed_up_belts: true };
    const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
    if (input.source.type !== "belt") throw new Error("expected belt input");
    input.source.pickup_length = geometry === "straight-belt" ? 1 : 0.5;
    input.source.pickup_layout = geometry === "straight-belt" ? "side-straight" : geometry === "underground-entrance" ? "side-entrance" : "side-exit";
    input.filters = [item];
    return config;
}

/** The ticks, counted from the first, on which the simulated input inserter takes stacks until its hand is full */
export function simulatedHand(config: Config): string {
    const context = SimulationContext.fromConfig(config);
    const input = context.inserters.find(inserter => inserter.inserter_state.inserter.source.entity_id.type === "belt")!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected belt input");
    const mode = InserterPickupMode.create({
        inserterState: input, sourceState: source, tick_provider: context.tick_provider,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id),
    });
    const configured = config.inserters.find(inserter => inserter.source.type === "belt")!;
    expect(input.inserter.pickup_length).toBe(configured.source.type === "belt" ? configured.source.pickup_length : undefined);
    expect(input.inserter.belt_supply).toBe("backed_up");
    // creating the mode registers the inserter's pickup lanes on the belt
    expect([...source.lanes[0].pickupIds()].length).toBe(1);
    const grabs: number[] = [];
    for (let tick = 0; tick < 20 && (input.held_item?.quantity ?? 0) < 16; tick++) {
        context.tick_provider.setCurrentTick(tick);
        const before = input.held_item?.quantity ?? 0;
        mode.executeForTick();
        if ((input.held_item?.quantity ?? 0) > before) grabs.push(tick);
    }
    expect(input.held_item?.quantity).toBe(16);
    return grabs.map(tick => tick - grabs[0]).join(",");
}
