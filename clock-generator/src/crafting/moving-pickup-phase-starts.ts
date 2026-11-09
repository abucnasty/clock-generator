import {Config} from "../config";
import {Entity} from "../entities";
import {BeltSpeed} from "../entities/belt";
import {createEntityRegistryFromConfig, MovingPickupPhases} from "./sequence/simulation-context";

/**
 * Bounded stock starts: vary both lanes of each ordinary moving pickup, one pickup at a time. A pickup is moving where
 * no lane of its belt ends in a dead end (an unknown end is read as a free outlet).
 * This does not enumerate simultaneous phase combinations across a conveyor network.
 */
export function* movingPickupPhaseStarts(config: Config): Generator<MovingPickupPhases> {
    const registry = createEntityRegistryFromConfig(config);
    for (const inserter of registry.getAll().filter(Entity.isInserter)) {
        // the starts seed both lanes of the pickup as moving: a pickup with a lane that ends in a dead end has none
        if (inserter.belt_lane_facts === undefined || inserter.belt_lane_facts.some(facts => facts.lane_end.kind === "dead_end")) continue;
        const source = registry.getSourceEntityOrThrow(inserter.entity_id);
        if (!Entity.isBelt(source)) continue;
        // Stacks are spaced 8 public units apart. Advance by one belt tick until the phase repeats.
        const phases = new Set<number>();
        const speed = source.belt_speed / BeltSpeed.TRANSPORT_BELT;
        for (let phase = 0; !phases.has(phase); phase = (phase + speed) % 8) phases.add(phase);
        const orbit = [...phases].sort((a, b) => a - b);
        const lanes = source.lanes.map(lane => inserter.filtered_items.has(lane.ingredient_name) ? orbit : [0]);
        for (const first of lanes[0] ?? [0]) for (const second of lanes[1] ?? [0]) {
            if (first === 0 && second === 0) continue; // already checked by the ordinary clock start
            yield new Map([[inserter.entity_id.id, [first, second] as const]]);
        }
    }
}
