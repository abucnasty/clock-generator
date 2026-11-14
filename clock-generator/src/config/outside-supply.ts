import type { Config } from './schema';

/**
 * Outside supply: what puts items onto a belt from outside the build. It is an inserter that takes from a chest nothing
 * drops into (no inserter, no machine that places its results into it, no drill) and drops onto a belt, in no machine's
 * subsystem. A chest that is not a buffer chest (an infinity chest, a car, a tank, a cargo wagon, a rocket silo) is never
 * part of a subsystem, so every such inserter from it is outside supply. A buffer chest is: it is outside the build only
 * when every inserter that takes from it drops onto a belt. A chest something drops into is part of the build's flow, and
 * an inserter from it is a member of the build.
 *
 * The conversion to one copy leaves outside supply out of the one copy (repeated-unit-conversion.ts), and a run of the
 * build as given clocks none of it (`withoutOutsideSupply`): in both, the belt counts as supplied, as its lanes state.
 */
export interface OutsideSupply {
    /** The inserters of outside supply, by their place in `config.inserters` */
    readonly inserters: ReadonlySet<number>;
    /** The chests nothing drops into whose every inserter is outside supply, by id; a chest nothing takes from is one */
    readonly chests: ReadonlySet<number>;
}

type SupplyConfig = Pick<Config, 'inserters' | 'machines' | 'chests' | 'drills'>;

/** The chests something drops into: an inserter, a machine that places its results, a drill */
function filledChests(config: SupplyConfig): Set<number> {
    return new Set([
        ...config.inserters.flatMap(inserter => inserter.sink.type === 'chest' ? [inserter.sink.id] : []),
        ...config.machines.flatMap(machine => machine.result_target?.type === 'chest' ? [machine.result_target.id] : []),
        ...(config.drills?.configs ?? []).flatMap(drill => drill.target.type === 'chest' ? [drill.target.id] : []),
    ]);
}

/** The outside supply of a configuration (see `OutsideSupply`) */
export function outsideSupplyOf(config: SupplyConfig): OutsideSupply {
    const filled = filledChests(config);
    const fillsBelt = (inserter: Config['inserters'][number]): boolean =>
        inserter.source.type === 'chest' && inserter.sink.type === 'belt' && !filled.has(inserter.source.id);
    // nothing drops into it and every inserter that takes from it drops onto a belt
    const apart = (chest_id: number): boolean => !filled.has(chest_id)
        && config.inserters.every(inserter => inserter.source.type !== 'chest' || inserter.source.id !== chest_id || fillsBelt(inserter));
    const isBufferChest = (chest_id: number): boolean => config.chests?.some(chest => chest.id === chest_id && chest.type === 'buffer-chest') ?? false;
    const inserters = new Set(config.inserters.flatMap((inserter, index) =>
        fillsBelt(inserter) && (!isBufferChest(inserter.source.id) || apart(inserter.source.id)) ? [index] : []));
    const chests = new Set((config.chests ?? []).flatMap(chest => apart(chest.id) ? [chest.id] : []));
    return { inserters, chests };
}

/**
 * The build that is clocked: the configuration without its outside supply (`outsideSupplyOf`). Each inserter it keeps keeps its
 * number (an inserter without an id is given the one its place gave it), so the clock's windows and texts name the
 * inserters as the configuration does; a chest that only the inserters left out took from is left out with them. The inserters
 * left out get no enable window and no combinator: in the game they stay as built, always enabled. The configuration itself, as
 * the same object, where it has no outside supply.
 */
export function withoutOutsideSupply<C extends Config>(config: C): C {
    const supply = outsideSupplyOf(config);
    if (supply.inserters.size === 0) return config;
    const inserters = config.inserters.flatMap((inserter, index) => supply.inserters.has(index) ? [] : [{ ...inserter, id: inserter.id ?? index + 1 }]);
    const referenced = new Set(inserters.flatMap(inserter => [inserter.source, inserter.sink].flatMap(end => end.type === 'chest' ? [end.id] : [])));
    const left = new Set(config.inserters.flatMap((inserter, index) => supply.inserters.has(index) && inserter.source.type === 'chest' ? [inserter.source.id] : []));
    const chests = config.chests?.filter(chest => !(left.has(chest.id) && supply.chests.has(chest.id) && !referenced.has(chest.id)));
    return { ...config, inserters, ...(chests !== undefined && { chests }) };
}
