import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";

/** A logger for the generations whose log the test does not read */
export const quiet = { log() { }, warn() { }, error() { }, debug() { } };

export interface RocketFuelSample {
    config: Config;
    alternatives: ClockAlternative[];
    alternative: (id: string) => ClockAlternative;
    /** Items an inserter moves in the planned period */
    moved: (inserter_id: string) => number;
    period: number;
    jelly_inserter_ids: string[];
    output_inserter_ids: string[];
    jellynut_inserter_id: string;
    bioflux_inserter_ids: string[];
}

/** What the rocket fuel samples have in common: two rocket fuel biochambers fed jelly by one jellynut biochamber */
export const rocketFuelSample = async (path: string): Promise<RocketFuelSample> => {
    const config = await loadConfigFromFile(path);
    const ids = (matches: (inserter: Config["inserters"][number]) => boolean) =>
        config.inserters.filter(matches).map(inserter => `inserter:${inserter.id}`);
    const { alternatives } = generateClockAlternatives(config);
    const alternative = (id: string) => alternatives.find(a => a.id === id)!;
    const moved = (inserter_id: string): number => alternative("planned").result.serializable_transfer_history.entities
        .find(entity => entity.entity_id === inserter_id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
    return {
        config,
        alternatives,
        alternative,
        moved,
        period: alternative("planned").result.simulation_duration.ticks,
        jelly_inserter_ids: ids(it => it.source.type === "machine" && it.sink.type === "machine"),
        output_inserter_ids: ids(it => it.source.type === "machine" && it.sink.type === "belt" && it.source.id !== 2),
        // belt 1 carries bioflux and jellynut: machine 2 takes the jellynut, the rocket fuel machines the bioflux
        jellynut_inserter_id: ids(it => it.source.type === "belt" && it.source.id === 1 && it.sink.id === 2)[0],
        bioflux_inserter_ids: ids(it => it.source.type === "belt" && it.source.id === 1 && it.sink.id !== 2),
    };
};
