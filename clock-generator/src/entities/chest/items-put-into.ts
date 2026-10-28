import { Config } from "../../config/schema";
import { FactorioDataService } from "../../data";

/** The products of the machines and the lanes' items of the belts of a config, by id; empty for an id it has none of */
export interface PutIntoView {
    machineOutputs(id: number): readonly string[];
    beltItems(id: number): readonly string[];
}

/**
 * The items the build's inserters put into a chest: an inserter's filters, else what its source gives (a machine's
 * products, a belt's lanes, a chest's configured items). A chest of mixed items can give these on. The machines'
 * products and the belts' lanes are read through `view`: the registry's entities (simulation-context.ts), or the
 * traits (entities/traits).
 */
export function itemsPutInto(config: Config, chest_id: number, view: PutIntoView): string[] {
    const items = new Set<string>();
    for (const inserter of config.inserters) {
        if (inserter.sink.type !== "chest" || inserter.sink.id !== chest_id) continue;
        if (inserter.filters && inserter.filters.length > 0) {
            inserter.filters.forEach(item => items.add(item));
            continue;
        }
        const source = inserter.source;
        if (source.type === "machine") {
            view.machineOutputs(source.id).forEach(item => items.add(item));
        } else if (source.type === "belt") {
            view.beltItems(source.id).forEach(item => items.add(item));
        } else if (source.type === "chest") {
            const chest = config.chests?.find(it => it.id === source.id);
            if (chest?.type === "buffer-chest") items.add(chest.item_filter);
            else if (chest?.type === "infinity-chest") chest.item_filter.forEach(filter => items.add(filter.item_name));
            else if (chest !== undefined) (chest.contents ?? []).forEach(content => items.add(content.item));
        }
    }
    // a machine that places its results into the chest puts in every result of its recipe
    for (const machine of config.machines) {
        if (machine.result_target?.type === "chest" && machine.result_target.id === chest_id) {
            view.machineOutputs(machine.id).forEach(item => items.add(item));
        }
    }
    // a drill that drops into the chest puts in what it mines
    for (const drill of config.drills?.configs ?? []) {
        if (drill.target.type === "chest" && drill.target.id === chest_id) {
            items.add(FactorioDataService.getResourceOrThrow(drill.mined_item_name).minable.result);
        }
    }
    return Array.from(items);
}
