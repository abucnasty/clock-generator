import fs from "fs";
import path from "path";
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { FactorioDataService } from "../data/factorio-data-service";

/**
 * A sample that says `copy_offset` says how far the next copy of its build stands. That spacing is wrong when the next
 * copy would stand in the copy before it. The copy is the one the sample's scaffold shows: its machines and drills, from
 * the game data's sizes. A scaffold of one copy (as many machines and drills as the config has) must be no wider along
 * the spacing than the spacing: the copies stand side by side on the shared lane, touching at the least (the rows of
 * machines of one copy may reach between those of the next, but a player puts the copies side by side). A scaffold of
 * several copies already holds the next copy: its machines moved by the spacing may stand exactly on a machine of the
 * scaffold, and may touch another, but not cover part of one.
 */

const SAMPLES = path.resolve(__dirname, "../../resources/config-samples");
const EPSILON = 1e-6;

interface Box { name: string; x0: number; y0: number; x1: number; y1: number }

const sampleConfigs = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sampleConfigs(file);
    return entry.name.endsWith(".json") ? [file] : [];
});

/** The scaffold of a sample: the one beside it with its name, else the only one in its folder; none when unclear */
function scaffoldOf(config: string): string | null {
    const own = config.replace(/\.json$/, ".scaffold");
    if (fs.existsSync(own)) return own;
    const beside = fs.readdirSync(path.dirname(config)).filter(name => name.endsWith(".scaffold"));
    return beside.length === 1 ? path.join(path.dirname(config), beside[0]) : null;
}

/** The tiles a machine or drill takes, by its prototype's size, turned by its direction (0 north, 4 east, ...) */
function machineBoxes(scaffold: string): Box[] {
    const text = fs.readFileSync(scaffold, "utf8").trim();
    const entities: { name: string; position: { x: number; y: number }; direction?: number }[] =
        JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString("utf8")).blueprint.entities;
    const drills = new Map(FactorioDataService.getAllMiningDrills().map(drill => [String(drill.name), drill]));
    return entities.flatMap(entity => {
        const size = FactorioDataService.findCraftingMachine(entity.name) ?? drills.get(entity.name);
        if (size === null || size === undefined) return [];
        const turned = entity.direction === 4 || entity.direction === 12;
        const width = turned ? size.tile_height : size.tile_width;
        const height = turned ? size.tile_width : size.tile_height;
        const { x, y } = entity.position;
        return [{ name: entity.name, x0: x - width / 2, y0: y - height / 2, x1: x + width / 2, y1: y + height / 2 }];
    });
}

const overlaps = (a: Box, b: Box) =>
    a.x0 < b.x1 - EPSILON && b.x0 < a.x1 - EPSILON && a.y0 < b.y1 - EPSILON && b.y0 < a.y1 - EPSILON;
const same = (a: Box, b: Box) => a.name === b.name
    && Math.abs(a.x0 - b.x0) < EPSILON && Math.abs(a.y0 - b.y0) < EPSILON && Math.abs(a.x1 - b.x1) < EPSILON && Math.abs(a.y1 - b.y1) < EPSILON;

/** The machines of the next copy that stand on a part of a machine of the scaffold: one line each */
function collisions(machines: Box[], offset: { x: number; y: number }): string[] {
    const next = machines.map(box => ({ ...box, x0: box.x0 + offset.x, x1: box.x1 + offset.x, y0: box.y0 + offset.y, y1: box.y1 + offset.y }));
    return next.flatMap(moved => machines
        .filter(held => overlaps(moved, held) && !same(moved, held))
        .map(held => `${moved.name} at x ${moved.x0}..${moved.x1} covers part of ${held.name} at x ${held.x0}..${held.x1}`));
}

/** The width of the machines along the spacing: the machines are in the way of the next copy where it is no more than the spacing */
function extentAgainst(machines: Box[], offset: { x: number; y: number }): string[] {
    const across = (lo: (box: Box) => number, hi: (box: Box) => number) => Math.max(...machines.map(hi)) - Math.min(...machines.map(lo));
    const width = across(box => box.x0, box => box.x1), height = across(box => box.y0, box => box.y1);
    const apart = (offset.x !== 0 && Math.abs(offset.x) >= width - EPSILON) || (offset.y !== 0 && Math.abs(offset.y) >= height - EPSILON);
    return apart ? [] : [`the machines of one copy are ${width} tiles wide and ${height} deep; the next copy stands ${offset.x} across and ${offset.y} down`];
}

const configs = sampleConfigs(SAMPLES).flatMap(file => {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const setpoint = typeof value === "object" && value !== null ? (value as { setpoint?: { copies?: number; copy_offset?: { x: number; y: number } } }).setpoint : undefined;
    const scaffold = setpoint?.copy_offset === undefined ? null : scaffoldOf(file);
    const parts = value as { machines?: unknown[]; drills?: { configs?: unknown[] } };
    const copyMachines = (parts.machines?.length ?? 0) + (parts.drills?.configs?.length ?? 0);
    return setpoint?.copy_offset === undefined || scaffold === null ? [] : [{ name: path.relative(SAMPLES, file), scaffold, offset: setpoint.copy_offset, copyMachines }];
});

describe("the copy spacing of a sample is at least its copy's machine footprint", () => {
    it("is checked for the samples that state a copy spacing and have a scaffold", () => {
        expect(configs.length).toBeGreaterThanOrEqual(10);
        expect(configs.map(config => config.name)).toContain(path.join("intermediates", "electric-furnace", "electric-furnace-20.json"));
    });

    it.each(configs.map(config => [config.name, config] as const))("%s", (_name, config) => {
        const machines = machineBoxes(config.scaffold);
        expect(machines.length, "the scaffold holds machines").toBeGreaterThan(0);
        const oneCopy = machines.length === config.copyMachines;
        expect(oneCopy ? extentAgainst(machines, config.offset) : collisions(machines, config.offset)).toEqual([]);
    });

    it("sees a spacing narrower than the machines: two machines 3 wide side by side are 6 wide", () => {
        const row: Box[] = [{ name: "m", x0: 0, y0: 0, x1: 3, y1: 3 }, { name: "m", x0: 3, y0: 0, x1: 6, y1: 3 }];
        expect(collisions(row, { x: 6, y: 0 })).toEqual([]);
        expect(collisions(row, { x: 5, y: 0 })).not.toEqual([]);
        expect(collisions([row[0]], { x: 3, y: 0 })).toEqual([]);
        expect(collisions([row[0]], { x: 2, y: 0 })).not.toEqual([]);
        expect(extentAgainst(row, { x: 6, y: 0 })).toEqual([]);
        expect(extentAgainst(row, { x: 5, y: 0 })).not.toEqual([]);
    });
});
