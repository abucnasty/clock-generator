// The one-copy scaffold of the utility science 320/s sample (utility-320-metered-takers.scaffold), held to the sample's config
// without a game: the generator's own matcher finds the config's 21 inserters in it (scripts/scaffold-cells.js), and what that
// match does not hold is read here: the nine machines and where they stand, their modules, the beacons in reach, the hands.
// So the reference scaffold stays one when either file is edited.
//
// One thing differs from the config on purpose, and is not tested as equal: the belts under inserters 1 and 19 run the other way
// from their belt_direction, which only orders drops in the drop-spacing note.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { ConfigPaths } from '../../src/config/config-paths';

const root = path.resolve(__dirname, '../..');

interface Point { x: number, y: number }
interface BlueprintEntity {
    entity_number: number,
    name: string,
    type?: string,
    position: Point,
    direction?: number,
    quality?: string,
    recipe?: string,
    override_stack_size?: number,
    items?: { id: { name: string, quality?: string }, items: { in_inventory: unknown[] } }[],
    infinity_settings?: { filters?: { name: string }[] },
}
interface ConfigInserter {
    id: number,
    source: { type: string, id: number },
    sink: { type: string, id: number, belt_direction?: number },
    quality: string,
    stack_size: number,
    position: Point,
    direction: number,
}
interface ConfigMachine { id: number, recipe: string, prototype: string, quality: string, position: Point }

const config: { machines: ConfigMachine[], inserters: ConfigInserter[] } = JSON.parse(fs.readFileSync(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS, 'utf-8'));
const scaffold_path = ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS.replace(/\.json$/, '.scaffold');
const scaffold_text = fs.readFileSync(scaffold_path, 'utf-8');
// as the harness reads a scaffold: the string without its first character is base64 of a zlib stream of JSON
const blueprint: { blueprint: { entities: BlueprintEntity[], label?: string, description?: string } } = JSON.parse(
    zlib.inflateSync(Buffer.from(scaffold_text.trim().slice(1), 'base64')).toString('utf-8'));
const entities = blueprint.blueprint.entities;
const entity = (number: number): BlueprintEntity => {
    const found = entities.find(it => it.entity_number === number);
    if (found === undefined) throw new Error(`the scaffold has no entity ${number}`);
    return found;
};

/** The sample's frame: where the config's (x, y) stands in the scaffold */
const placed = ({ x, y }: Point): Point => ({ x: y + 305, y: x + 76 });
/** The frame turns a heading as it turns the plane (it swaps the axes): north to west, east to south, south to east, west to north */
const heading = (direction: number): number => ({ 0: 12, 4: 8, 8: 4, 12: 0 } as Record<number, number>)[direction];

/** Width and height in tiles facing north of what the scaffold holds; one tile where a name is not here */
const SIZE: Record<string, [number, number]> = {
    'assembling-machine-3': [3, 3], 'beacon': [3, 3], 'foundry': [5, 5], 'cryogenic-plant': [5, 5],
};
const MACHINES = ['assembling-machine-3', 'foundry', 'cryogenic-plant'];
const sizeOf = (it: BlueprintEntity): [number, number] => {
    const [w, h] = SIZE[it.name] ?? [1, 1];
    if (/loader$/.test(it.name)) return Math.round((it.direction ?? 0) / 4) % 2 === 1 ? [2, 1] : [1, 2];
    return [w, h];
};
/** The tiles an entity takes: [x0, y0, x1, y1] as half-open ranges of whole tiles */
const tilesOf = (it: BlueprintEntity): [number, number, number, number] => {
    const [w, h] = sizeOf(it);
    const x0 = it.position.x - w / 2, y0 = it.position.y - h / 2;
    return [x0, y0, x0 + w, y0 + h];
};
const at = (x: number, y: number): BlueprintEntity | undefined => {
    for (let i = entities.length - 1; i >= 0; i--) {
        const [x0, y0, x1, y1] = tilesOf(entities[i]);
        if (x > x0 && x < x1 && y > y0 && y < y1) return entities[i];
    }
    return undefined;
};
const VECTOR: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };
/** What an inserter picks from and drops on, as the entities that stand there (a stack inserter: one tile each way) */
const endsOf = (inserter: BlueprintEntity) => {
    const [vx, vy] = VECTOR[inserter.direction ?? 0];
    return { pickup: at(inserter.position.x + vx, inserter.position.y + vy), drop: at(inserter.position.x - vx, inserter.position.y - vy) };
};
const BELT = /(transport-belt|underground-belt|splitter|loader)$/;

/** The scaffold entity at the place of each config machine, by the frame */
const machine_entities = new Map(config.machines.map(machine => {
    const centre = placed(machine.position);
    const found = entities.filter(it => it.position.x === centre.x && it.position.y === centre.y && it.name === machine.prototype && it.recipe === machine.recipe);
    expect(found, `config machine ${machine.id}: one ${machine.prototype} making ${machine.recipe} at ${JSON.stringify(centre)}`).toHaveLength(1);
    return [machine.id, found[0]] as const;
}));

/**
 * The scaffold read as the sidecar reads a build, laid against the config by the generator's own matcher. It needs the build
 * of the generator (dist/), as the cells test of the export script does.
 */
const cells = (() => {
    const code = `const { dist, loadSample } = require('./lib'); const zlib = require('zlib'), fs = require('fs'); const { cellOf } = require('./scaffold-cells');
        const { ConfigPaths } = dist('config/config-paths.js');
        loadSample('UTILITY_SCIENCE_320_METERED_TAKERS').then(config => {
            const text = fs.readFileSync(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS.replace(/\\.json$/, '.scaffold'), 'utf-8').trim();
            const blueprint = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), 'base64')).toString('utf-8'));
            const { cell, matched } = cellOf({ blueprint, config, name: 'utility', clock_file: 'utility.json' });
            console.log(JSON.stringify({ matched, count: config.inserters.length, problems: cell.problems, inserters: cell.inserters }));
        });`;
    const result = spawnSync('node', ['-e', code], { cwd: path.join(root, 'scripts'), encoding: 'utf-8' });
    expect(result.status, String(result.stderr)).toBe(0);
    return JSON.parse(result.stdout) as { matched: number, count: number, problems: string[], inserters: Record<string, { name: string, offset: [number, number] }> };
})();

/** The six inserters that the frame does not place (a tile or two off, one turned); they are held by role and by where they stand */
const ROLE_MATCHED: Record<number, { entity: number, x: number, y: number, direction: number, from: string, to: string }> = {
    3: { entity: 61, x: 228.5, y: 161.5, direction: 8, from: 'belt', to: 'machine 2' },
    4: { entity: 75, x: 230.5, y: 161.5, direction: 0, from: 'machine 2', to: 'belt' },
    7: { entity: 104, x: 237.5, y: 152.5, direction: 12, from: 'belt', to: 'machine 4' },
    10: { entity: 121, x: 240.5, y: 161.5, direction: 8, from: 'belt', to: 'machine 5' },
    18: { entity: 171, x: 250.5, y: 143.5, direction: 8, from: 'machine 8', to: 'belt' },
    21: { entity: 191, x: 253.5, y: 152.5, direction: 4, from: 'belt', to: 'machine 9' },
};

const configured_inserter = (id: number): ConfigInserter => config.inserters.find(it => it.id === id)!;
/**
 * The scaffold inserter of a config inserter, by the frame (15 of them) or by the table above (the other 6). The matcher cannot tell the
 * two regions of the build apart (foundry 3 with assemblers 1, 2 and 5, and foundry 7 with 6, 8 and 9), so the ids it gives are not used:
 * it is the frame that fixes which scaffold inserter is which.
 */
const inserter_of = (id: number): BlueprintEntity => {
    const table = ROLE_MATCHED[id];
    if (table !== undefined) return entity(table.entity);
    const centre = placed(configured_inserter(id).position);
    const found = entities.filter(it => it.name === 'stack-inserter' && it.position.x === centre.x && it.position.y === centre.y);
    expect(found, `one stack inserter at ${JSON.stringify(centre)} for inserter ${id}`).toHaveLength(1);
    return found[0];
};
const role = (kind: string, id: number | undefined) => id === undefined ? kind : `${kind} ${id}`;
const end_role = (end: BlueprintEntity | undefined): string => {
    if (end === undefined) return 'nothing';
    if (BELT.test(end.name)) return 'belt';
    const machine = [...machine_entities].find(([, it]) => it === end);
    return machine === undefined ? end.name : role('machine', machine[0]);
};

describe('the utility science 320/s scaffold against its config: inserters', () => {
    it('is found by the generator\'s own matcher: all 21 inserters of the config, and nothing it has to report', () => {
        expect(cells.count).toBe(21);
        expect(cells.problems).toEqual([]);
        expect(cells.matched).toBe(21);
        expect(Object.keys(cells.inserters).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
        // 21 different scaffold inserters (which one is which is the frame's, below)
        expect(new Set(Object.values(cells.inserters).map(it => it.offset.join(','))).size).toBe(21);
    });

    it('stands where the frame puts 15 of them, with the heading the frame gives, and the other 6 stand where the table says', () => {
        const by_frame: number[] = [];
        for (const configured of config.inserters) {
            const found = inserter_of(configured.id);
            const wanted = ROLE_MATCHED[configured.id];
            if (wanted === undefined) {
                expect({ ...found.position, direction: found.direction ?? 0 }, `inserter ${configured.id}`).toEqual({ ...placed(configured.position), direction: heading(configured.direction) });
                by_frame.push(configured.id);
            } else {
                // a later edit that moves or turns one of these fails here: the review of the scaffold rests on these places
                expect({ entity: found.entity_number, ...found.position, direction: found.direction ?? 0 }, `inserter ${configured.id}`)
                    .toEqual({ entity: wanted.entity, x: wanted.x, y: wanted.y, direction: wanted.direction });
            }
        }
        expect(by_frame).toHaveLength(15);
        expect(Object.keys(ROLE_MATCHED).map(Number).sort((a, b) => a - b)).toEqual([3, 4, 7, 10, 18, 21]);
    });

    it('has each end of each inserter on what the config says: the same machine, or a belt', () => {
        for (const configured of config.inserters) {
            const { pickup, drop } = endsOf(inserter_of(configured.id));
            const wanted = (end: { type: string, id: number }) => end.type === 'machine' ? `machine ${end.id}` : end.type;
            expect({ from: end_role(pickup), to: end_role(drop) }, `inserter ${configured.id}`).toEqual({ from: wanted(configured.source), to: wanted(configured.sink) });
            const table = ROLE_MATCHED[configured.id];
            if (table !== undefined) expect({ from: table.from, to: table.to }, `table for inserter ${configured.id}`).toEqual({ from: wanted(configured.source), to: wanted(configured.sink) });
        }
    });

    it('gives each inserter the hand of its config: 15 on the two that take plastic, 16 on the rest', () => {
        for (const configured of config.inserters) {
            const found = inserter_of(configured.id);
            expect(found.name, `inserter ${configured.id}`).toBe('stack-inserter');
            expect(found.quality, `inserter ${configured.id}`).toBe(configured.quality);
            // an inserter with no override has the hand of its quality: 16 for a legendary stack inserter
            expect(found.override_stack_size ?? 16, `inserter ${configured.id}`).toBe(configured.stack_size);
        }
        expect(configured_inserter(8).stack_size).toBe(15);
        expect(configured_inserter(15).stack_size).toBe(15);
        expect(inserter_of(8).override_stack_size).toBe(15);
        expect(inserter_of(15).override_stack_size).toBe(15);
        const overridden = entities.filter(it => it.override_stack_size !== undefined).map(it => it.entity_number).sort((a, b) => a - b);
        expect(overridden, 'no other inserter of the scaffold has an override').toEqual([inserter_of(8).entity_number, inserter_of(15).entity_number].sort((a, b) => a - b));
    });

    it('has nothing extra on a config machine: every inserter that touches one is an inserter of the config', () => {
        const machines = new Set(machine_entities.values());
        const touching = entities.filter(it => /inserter$/.test(it.name)).filter(it => {
            const { pickup, drop } = endsOf(it);
            return (pickup !== undefined && machines.has(pickup)) || (drop !== undefined && machines.has(drop));
        }).map(it => it.entity_number).sort((a, b) => a - b);
        const config_ones = config.inserters.map(it => inserter_of(it.id).entity_number).sort((a, b) => a - b);
        expect(touching).toEqual(config_ones);
        // and no loader stands on a machine of the config
        expect(entities.filter(it => /loader$/.test(it.name)).filter(it => machines.has(at(it.position.x, it.position.y)!))).toEqual([]);
    });
});

describe('the utility science 320/s scaffold against its config: machines, modules and beacons', () => {
    it('has the nine machines of the config, and no other machine, each at the place of the frame', () => {
        expect(config.machines).toHaveLength(9);
        expect(entities.filter(it => MACHINES.includes(it.name))).toHaveLength(9);
        expect(new Set(machine_entities.values()).size).toBe(9);
        for (const machine of config.machines) {
            expect(machine_entities.get(machine.id)!.quality, `machine ${machine.id}`).toBe(machine.quality);
        }
    });

    const modules = (it: BlueprintEntity) => (it.items ?? []).map(stack => `${stack.items.in_inventory.length} ${stack.id.quality} ${stack.id.name}`);

    it('holds 4 legendary speed module 3 in each foundry, 8 in the cryogenic plant and 4 legendary productivity module 3 in each assembler', () => {
        for (const machine of config.machines) {
            const wanted = machine.prototype === 'foundry' ? ['4 legendary speed-module-3']
                : machine.prototype === 'cryogenic-plant' ? ['8 legendary speed-module-3'] : ['4 legendary productivity-module-3'];
            expect(modules(machine_entities.get(machine.id)!), `machine ${machine.id} (${machine.prototype})`).toEqual(wanted);
        }
    });

    it('has the beacons in reach that the speeds rest on: 10 for each assembler, 5 for each foundry and 8 for the plant', () => {
        // a beacon reaches a machine when the machine stands within 3 tiles of its 3 x 3 (a supply area of 9 x 9 tiles); touching along
        // an edge is no reach, so the boxes must overlap by more than a line. Each beacon holds 2 legendary speed module 3, so the count
        // of beacons gives the speed (the crafting speeds of the nine machines are not tested here).
        const beacons = entities.filter(it => it.name === 'beacon');
        expect(beacons).toHaveLength(50);
        for (const beacon of beacons) {
            expect(modules(beacon), `beacon ${beacon.entity_number}`).toEqual(['2 legendary speed-module-3']);
            expect(beacon.quality, `beacon ${beacon.entity_number}`).toBe('legendary');
        }
        const reach = (machine: BlueprintEntity) => {
            const [mx0, my0, mx1, my1] = tilesOf(machine);
            return beacons.filter(beacon => {
                const [bx0, by0, bx1, by1] = tilesOf(beacon);
                const [ax0, ay0, ax1, ay1] = [bx0 - 3, by0 - 3, bx1 + 3, by1 + 3];
                return mx0 < ax1 && mx1 > ax0 && my0 < ay1 && my1 > ay0;
            }).length;
        };
        for (const machine of config.machines) {
            const wanted = machine.prototype === 'foundry' ? 5 : machine.prototype === 'cryogenic-plant' ? 8 : 10;
            expect(reach(machine_entities.get(machine.id)!), `machine ${machine.id} (${machine.prototype})`).toBe(wanted);
        }
    });
});

/**
 * The scaffold's belts read by position, as the game joins them: a belt or an underground exit pushes onto the tile ahead; a belt
 * it pushes into from behind continues it, and one it pushes into from a side is a curve when nothing else feeds that belt (a turn
 * keeps each lane), else a side load. An underground entrance takes the first underground belt of its name on its axis within its
 * reach, and pairs with it when that one is an exit facing the same way. A loader takes from its back tile.
 */
const REACH: Record<string, number> = { 'turbo-underground-belt': 11, 'express-underground-belt': 9 };
const tileKey = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`;
const belt_at = new Map<string, BlueprintEntity>();
for (const it of entities.filter(it => BELT.test(it.name))) {
    const [x0, y0, x1, y1] = tilesOf(it);
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) belt_at.set(tileKey(x, y), it);
}
const headingOf = (it: BlueprintEntity) => it.direction ?? 0;
const kindOf = (it: BlueprintEntity) => /loader$/.test(it.name) ? 'loader' : /underground-belt$/.test(it.name)
    ? (it.type === 'output' ? 'exit' : 'entrance') : 'belt';
const ahead = (it: BlueprintEntity, steps = 1): BlueprintEntity | undefined => {
    const [vx, vy] = VECTOR[headingOf(it)];
    return belt_at.get(tileKey(it.position.x + vx * steps, it.position.y + vy * steps));
};
/** How a belt that pushes with heading `d` enters `into`: from behind, from a side, or not at all */
const entry = (d: number, into: BlueprintEntity, from: BlueprintEntity): 'behind' | 'side' | null => {
    const r = headingOf(into), kind = kindOf(into);
    if (kind === 'loader') {
        const [vx, vy] = VECTOR[r];
        const back = tileKey(into.position.x - vx * 0.5, into.position.y - vy * 0.5);
        return d === r && back === tileKey(from.position.x + VECTOR[d][0], from.position.y + VECTOR[d][1]) ? 'behind' : null;
    }
    if (kind === 'exit') return d === r || d === (r + 8) % 16 ? null : 'side';
    return d === r ? 'behind' : d === (r + 8) % 16 ? null : 'side';
};
const pushes = (it: BlueprintEntity) => kindOf(it) === 'belt' || kindOf(it) === 'exit';
const feeders = (into: BlueprintEntity) => entities.filter(it => BELT.test(it.name) && pushes(it) && ahead(it) === into && entry(headingOf(it), into, it) !== null);
const exitOf = (entrance: BlueprintEntity): BlueprintEntity | undefined => {
    for (let k = 1; k <= (REACH[entrance.name] ?? 0); k++) {
        const it = ahead(entrance, k);
        if (it === undefined || it.name !== entrance.name || (headingOf(it) !== headingOf(entrance) && headingOf(it) !== (headingOf(entrance) + 8) % 16)) continue;
        return kindOf(it) === 'exit' && headingOf(it) === headingOf(entrance) ? it : undefined;
    }
    return undefined;
};
/** Left of a heading, in the blueprint's plane (y grows to the south) */
const leftOf = (d: number): [number, number] => { const [x, y] = VECTOR[d]; return [y, -x]; };
/**
 * From the belt an output inserter drops on to the loader it reaches: the loader, the lane its items arrive on (left or right of the
 * loader's heading), every side load on the way, and the count of belts walked (more is further upstream). The inserter drops on
 * the lane of the belt away from it.
 */
const pathOf = (inserter: BlueprintEntity) => {
    const [vx, vy] = VECTOR[headingOf(inserter)];
    let belt = at(inserter.position.x - vx, inserter.position.y - vy);
    expect(belt !== undefined && kindOf(belt) === 'belt', `the drop of entity ${inserter.entity_number} is a belt`).toBe(true);
    const [lx, ly] = leftOf(headingOf(belt!));
    let lane: 'left' | 'right' = -vx === lx && -vy === ly ? 'left' : 'right';
    const side_loads: number[] = [];
    for (let steps = 0; steps < 200; steps++) {
        const kind = kindOf(belt!);
        if (kind === 'loader') return { loader: belt!.entity_number, lane, side_loads, belts_walked: steps + 1 };
        let next: BlueprintEntity | undefined;
        if (kind === 'entrance') next = exitOf(belt!);
        else {
            next = ahead(belt!);
            const how = next === undefined ? null : entry(headingOf(belt!), next, belt!);
            if (next === undefined || how === null) return { loader: null, lane, side_loads, belts_walked: steps + 1 };
            if (how === 'side') {
                const others = feeders(next).filter(it => it !== belt);
                const curve = kindOf(next) === 'belt' && others.length === 0;
                if (!curve) {
                    side_loads.push(next.entity_number);
                    const [nx, ny] = leftOf(headingOf(next));
                    lane = belt!.position.x - next.position.x === nx && belt!.position.y - next.position.y === ny ? 'left' : 'right';
                }
            }
        }
        if (next === undefined) return { loader: null, lane, side_loads, belts_walked: steps + 1 };
        belt = next;
    }
    throw new Error(`no end to the belt from entity ${inserter.entity_number}`);
};

describe('the utility science 320/s scaffold against its config: output belts', () => {
    const outputs = config.inserters.filter(it => it.sink.type === 'belt');
    const paths = new Map(outputs.map(it => [it.id, pathOf(inserter_of(it.id))] as const));
    const laneOf = (id: number) => `loader ${paths.get(id)!.loader} ${paths.get(id)!.lane}`;

    it('drops each output on a belt that side-loads once onto an output belt on the way to its loader', () => {
        expect(outputs.map(it => it.id)).toEqual([1, 4, 11, 13, 18, 19]);
        expect(Object.fromEntries([...paths].map(([id, path]) => [id, path.side_loads])))
            .toEqual({ 1: [69], 4: [80], 11: [114], 13: [135], 18: [176], 19: [196] });
    });

    it('takes the outputs to the two loaders, each inserter to its lane, upstream first', () => {
        const lanes: Record<string, number[]> = {};
        for (const [id] of [...paths].sort(([, a], [, b]) => b.belts_walked - a.belts_walked)) lanes[laneOf(id)] = [...(lanes[laneOf(id)] ?? []), id];
        expect(lanes).toEqual({ 'loader 228 right': [1], 'loader 228 left': [11, 18], 'loader 229 right': [4, 13], 'loader 229 left': [19] });
    });

    it('puts the outputs of one config belt only on each lane', () => {
        const belts = new Map<string, Set<number>>();
        for (const configured of outputs) belts.set(laneOf(configured.id), new Set([...(belts.get(laneOf(configured.id)) ?? []), configured.sink.id]));
        for (const [lane, ids] of belts) expect([...ids], `config belts on ${lane}`).toHaveLength(1);
        expect(belts.size).toBe(4);
    });

    it('runs the belt under each output inserter the way the frame turns its belt_direction, but the other way under 1 and 19', () => {
        const under = Object.fromEntries(outputs.map(configured => {
            const { drop } = endsOf(inserter_of(configured.id));
            return [configured.id, { entity: drop!.entity_number, heading: headingOf(drop!) }];
        }));
        expect(under).toEqual({
            1: { entity: 59, heading: 4 }, 4: { entity: 76, heading: 4 }, 11: { entity: 110, heading: 0 },
            13: { entity: 136, heading: 0 }, 18: { entity: 170, heading: 4 }, 19: { entity: 180, heading: 4 },
        });
        for (const configured of outputs) {
            const turned = heading(configured.sink.belt_direction!);
            expect(under[configured.id].heading, `belt under inserter ${configured.id}`).toBe([1, 19].includes(configured.id) ? (turned + 8) % 16 : turned);
        }
    });
});

describe('the utility science 320/s scaffold file', () => {
    it('is one line of text, a blueprint with no label, description or note naming anyone', () => {
        expect(scaffold_text).toMatch(/^0[A-Za-z0-9+/=]+\n?$/);
        expect(blueprint.blueprint.label).toBeUndefined();
        expect(blueprint.blueprint.description).toBeUndefined();
        expect(entities.filter(it => 'player_description' in it || 'tags' in it)).toEqual([]);
    });
});
