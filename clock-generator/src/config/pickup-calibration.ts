import { FactorioDataService } from "../data/factorio-data-service";
import { BurnerEnergySource, MachineType } from "../entities";
import { effectiveHandSize } from "../entities/inserter/inserter";
import { configuredHandSize } from "../entities/inserter/metadata/inserter-spec";
import type { Logger } from "../common/logger";
import { chestAcceptsItem, filtersExclude } from "./inserter-coverage-validator";
import { isLegendaryStackInserter } from "./inserter-scope";
import { Config, InserterConfig } from "./schema";

/** The hand and the belt stack every belt pickup was measured with in the game (docs/belt-pickup/experiments.md) */
const CALIBRATED_HAND_SIZE = 16;
const CALIBRATED_BELT_STACK_SIZE = 4;

/**
 * A belt pickup outside what belt pickup timing was calibrated on: an item an inserter takes off a belt in stacks other
 * than 4, or with a hand other than 16. Nothing was measured there (follow-up F7), so the simulator's timing is untested.
 */
export interface UncalibratedBeltPickup {
    inserter_id: number;
    belt_id: number;
    item: string;
    /** The stack sizes other than 4 of the belt's lanes that carry the item, smallest first; empty when all are 4 */
    lane_stack_sizes: number[];
    /** The inserter's hand for the item, when it is not 16 */
    hand_size: number | null;
    /** The item's own stack size, when it is what makes the hand smaller than the inserter's */
    item_stack_size: number | null;
}

/** What the sink of an inserter takes of an item, as the coverage check reads it: a machine its ingredients and fuel */
function sinkTakes(config: Config, inserter: InserterConfig, item: string): boolean {
    const sink = inserter.sink;
    if (sink.type === "machine") {
        const machine = config.machines.find(it => it.id === sink.id);
        if (machine === undefined) return false;
        const burner = BurnerEnergySource.forMachineType(machine.type ?? MachineType.MACHINE);
        return FactorioDataService.findRecipeOrThrow(machine.recipe).ingredients.some(it => it.name === item)
            || (burner !== undefined && BurnerEnergySource.selectFuel(burner, machine.fuel).item_name === item);
    }
    if (sink.type === "chest") {
        const chest = config.chests?.find(it => it.id === sink.id);
        return chest !== undefined && chestAcceptsItem(chest, item);
    }
    return false;
}

/** The belt pickups of an inserter that are outside the calibration, one per item it takes off its belt */
function uncalibratedPickupsOf(config: Config, inserter: InserterConfig, inserter_id: number): UncalibratedBeltPickup[] {
    const source = inserter.source;
    const belt = source.type === "belt" ? config.belts.find(it => it.id === source.id) : undefined;
    if (belt === undefined || !isLegendaryStackInserter(inserter)) return [];
    const hand = configuredHandSize(inserter);
    const items = [...new Set(belt.lanes.map(lane => lane.ingredient))]
        .filter(item => !filtersExclude(inserter, item) && sinkTakes(config, inserter, item));
    return items.flatMap(item => {
        const lane_stack_sizes = [...new Set(belt.lanes.filter(lane => lane.ingredient === item).map(lane => lane.stack_size))]
            .filter(size => size !== CALIBRATED_BELT_STACK_SIZE).sort((a, b) => a - b);
        // the simulator's own pickup hand: the item's stack size cuts it, the belt stack does not
        const item_hand = effectiveHandSize(hand, item);
        const hand_size = item_hand === CALIBRATED_HAND_SIZE ? null : item_hand;
        if (lane_stack_sizes.length === 0 && hand_size === null) return [];
        return [{ inserter_id, belt_id: belt.id, item, lane_stack_sizes, hand_size,
            item_stack_size: hand_size !== null && hand_size < hand ? hand_size : null }];
    });
}

/**
 * Every belt pickup of a config whose timing is not tested: an item a belt-fed inserter takes in belt stacks other than
 * 4 or with a hand other than 16 (follow-up F7). Only the legendary stack inserter is read, the one inserter allowed to
 * pick up from a belt; the others are refused for that. Read from the config alone, so that the live editor can show it
 * while the build is half made: an inserter whose recipe, fuel or item the data does not know is left out, never thrown
 * on.
 */
export function uncalibratedBeltPickups(config: Config): UncalibratedBeltPickup[] {
    return config.inserters.flatMap((inserter, index) => {
        try {
            return uncalibratedPickupsOf(config, inserter, inserter.id ?? index + 1);
        } catch {
            return [];
        }
    });
}

const article = (count: number) => /^(8|1[18]$)/.test(String(count)) ? "an" : "a";

/** "Inserter 3 picks up iron-plate from belt 2 in 2-item belt stacks with a 12-item hand." */
export function describeUncalibratedPickup(pickup: UncalibratedBeltPickup): string {
    const sizes = pickup.lane_stack_sizes;
    const stacks = sizes.length === 0 ? ""
        : ` in ${sizes.slice(0, -1).map(size => `${size}-`).join(", ")}${sizes.length > 1 ? " and " : ""}${sizes[sizes.length - 1]}-item belt stacks`;
    const hand = pickup.hand_size === null ? ""
        : ` with ${article(pickup.hand_size)} ${pickup.hand_size}-item hand`
            + (pickup.item_stack_size === null ? "" : ` (${pickup.item} stacks to ${pickup.item_stack_size})`);
    return `Inserter ${pickup.inserter_id} picks up ${pickup.item} from belt ${pickup.belt_id}${stacks}${hand}.`;
}

/** What belt pickup timing was calibrated on, and what that means elsewhere */
export const BELT_PICKUP_CALIBRATION = "Belt pickup timing is calibrated with 16-item hands on 4-item belt stacks only";

/**
 * The warning for a build with belt pickups outside the calibration, the same in the log and in the live editor; null
 * when every belt pickup is inside it.
 */
export function beltPickupNotTestedNote(pickups: readonly UncalibratedBeltPickup[]): string | null {
    if (pickups.length === 0) {
        return null;
    }
    return `Not tested: ${pickups.map(describeUncalibratedPickup).join(" ")} ${BELT_PICKUP_CALIBRATION}; at other belt stack `
        + "sizes and hand sizes it has not been compared with the game, so the clock may not match the game.";
}

/** Logs the warning once for a generation whose config has belt pickups outside the calibration */
export function warnUncalibratedBeltPickups(config: Config, logger: Logger): void {
    const note = beltPickupNotTestedNote(uncalibratedBeltPickups(config));
    if (note !== null) {
        logger.warn(note);
    }
}
