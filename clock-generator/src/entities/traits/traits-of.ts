import { Config } from "../../config/schema";
import Fraction from "../../data-types/fraction";
import { EntityId } from "../entity-id";
import { buildTraits, ConfigTraits, MachineTraits } from "./build-traits";
import { fractionOf } from "./ratio";

/** The traits of each config object the planner has read them of */
const traits_of = new WeakMap<Config, ConfigTraits>();

/**
 * A config's traits (buildTraits), built on the first read and kept with the config object, so that every planner step
 * of a generation that reads them (the output capacity of the machines that make the target, the machines' rates at the
 * target, the sinks that never refuse a hand) reads one set and nothing builds it again. A config is not changed once
 * the planner holds it: a candidate's, a trial's and a copy's config are new objects (spreads, structuredClone), so each
 * has traits of its own. Read-only, as the planner facts are.
 */
export function traitsOf(config: Config): ConfigTraits {
    let traits = traits_of.get(config);
    if (traits === undefined) {
        traits = buildTraits(config);
        traits_of.set(config, traits);
    }
    return traits;
}

/** A machine's traits by its entity id ("machine:3") */
export function traitsOfMachine(traits: ConfigTraits, entity_id: string): MachineTraits {
    const node = traits[entity_id];
    if (node?.kind !== "machine") {
        throw new Error(`${entity_id} is no machine of the config`);
    }
    return node;
}

/**
 * The machines' traits in the order the entity registry holds the machines (simulation-context.ts): the config's order,
 * a machine id the config names twice once, at its first place with its last entry, as the registry and the traits keep it
 */
export function machinesInOrder(config: Config, traits: ConfigTraits): MachineTraits[] {
    return Array.from(new Set(config.machines.map(machine => EntityId.forMachine(machine.id).id)), id => traitsOfMachine(traits, id));
}

/** What a machine makes of its main product a second at full speed: its Yield trait's first result, the exact rate */
export function mainProductRateOf(traits: ConfigTraits, machine_id: string): Fraction {
    return fractionOf(traitsOfMachine(traits, machine_id).yield.results[0].per_second);
}

/**
 * What an inserter moves of an item a swing, as its Hand trait gives it: its hand of an item it carries, its nominal
 * hand for any other (as `handSizeFor` reads the entity's)
 */
export function handOfItem(traits: ConfigTraits, inserter_id: string, item: string): number {
    const node = traits[inserter_id];
    if (node?.kind !== "inserter") {
        throw new Error(`${inserter_id} is no inserter of the config`);
    }
    return node.hand.by_item.find(hand => hand.item === item)?.hand ?? node.hand.nominal;
}

/**
 * Whether the node an inserter drops into never refuses a hand: a container whose Storage trait says so (an infinity
 * chest, as `isNeverBlockingSink` reads the entity); a belt, a machine or a chest with room does not
 */
export function neverRefuses(traits: ConfigTraits, sink_id: string): boolean {
    const node = traits[sink_id];
    return node?.kind === "chest" && node.storage.never_refuses;
}
