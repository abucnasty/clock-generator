import { describe, it, expect } from "vitest";
import { OpenRange } from "../data-types";
import { entityDescriptionHeaderLines, moduloSignalRanges, splitRepeatingRanges } from "./blueprint";
import { EntityId, ReadableEntityRegistry } from "../entities";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { generateClockForConfig } from "./generate-blueprint";

/** Replays the circuit: the clock reads `tick % period`, the modulo combinator one tick later */
function enabledTicksMatch(ranges: OpenRange[], period: number): boolean {
    const split = splitRepeatingRanges(ranges, period);
    if (!split) {
        return true;
    }
    const modulo_ranges = moduloSignalRanges(split.repeating, split.modulus);
    const inAny = (rs: OpenRange[], value: number) => rs.some(r => r.contains(value));
    for (let tick = period; tick < 3 * period; tick++) {
        const clock = tick % period;
        const modulo = ((tick - 1) % period) % split.modulus;
        const expected = inAny(ranges, clock);
        const actual = inAny(modulo_ranges, modulo) || inAny(split.remaining, clock);
        if (expected !== actual) {
            return false;
        }
    }
    return true;
}

function windowsEvery(spacing: number, length: number, period: number, offset = 0): OpenRange[] {
    const ranges: OpenRange[] = [];
    for (let start = offset; start < period; start += spacing) {
        ranges.push(OpenRange.from(start, Math.min(start + length - 1, period - 1)));
    }
    return ranges;
}

describe("splitRepeatingRanges", () => {
    it("checks windows repeating every crafting cycle against the clock modulo the cycle", () => {
        const ranges = windowsEvery(48, 5, 5808, 10);
        const split = splitRepeatingRanges(ranges, 5808);
        expect(split).toEqual({ modulus: 48, repeating: [OpenRange.from(10, 14)], remaining: [] });
        expect(enabledTicksMatch(ranges, 5808)).toBe(true);
    });

    it("keeps the windows that do not repeat as clock windows", () => {
        const ranges = OpenRange.reduceRanges([...windowsEvery(48, 4, 960, 2), OpenRange.from(100, 110), OpenRange.from(500, 503)]);
        const split = splitRepeatingRanges(ranges, 960)!;
        expect(split.modulus).toBe(48);
        expect(split.remaining.length).toBeGreaterThan(0);
        expect(enabledTicksMatch(ranges, 960)).toBe(true);
    });

    it("handles windows starting at the period boundary, where the modulo signal wraps", () => {
        const ranges = windowsEvery(24, 3, 480, 0);
        expect(splitRepeatingRanges(ranges, 480)?.modulus).toBe(24);
        expect(enabledTicksMatch(ranges, 480)).toBe(true);
    });

    it("leaves windows without a repeating pattern alone", () => {
        expect(splitRepeatingRanges([OpenRange.from(3, 9), OpenRange.from(40, 47), OpenRange.from(200, 210)], 480)).toBeNull();
    });

    it("leaves fractional periods alone", () => {
        expect(splitRepeatingRanges(windowsEvery(24, 3, 480), 480.5)).toBeNull();
    });

    it("matches the windows tick for tick for irregular patterns", () => {
        let seed = 7;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (let trial = 0; trial < 40; trial++) {
            const period = [96, 240, 528, 960][trial % 4];
            const base = windowsEvery([12, 24, 48][trial % 3], 1 + Math.floor(random() * 6), period, Math.floor(random() * 12));
            const extra = Array.from({ length: 3 }, () => {
                const start = Math.floor(random() * (period - 5));
                return OpenRange.from(start, start + Math.floor(random() * 5));
            });
            const dropped = base.filter(() => random() > 0.1);
            expect(enabledTicksMatch(OpenRange.reduceRanges([...dropped, ...extra]), period)).toBe(true);
        }
    });
});

describe("entityDescriptionHeaderLines", () => {
    const machine = (id: number, recipe: string) => ({ entity_id: EntityId.forMachine(id), metadata: { recipe: { name: recipe } } });
    const inserter = (id: number, source: EntityId, sink: EntityId) =>
        ({ entity_id: EntityId.forInserter(id), source: { entity_id: source }, sink: { entity_id: sink } });
    const belt = EntityId.forBelt(1);
    const entities = [
        machine(1, "rocket-fuel-from-jelly"),
        machine(2, "jellynut-processing"),
        inserter(1, belt, EntityId.forMachine(1)),
        inserter(2, EntityId.forMachine(1), belt),
        inserter(3, belt, EntityId.forMachine(2)),
        inserter(6, EntityId.forMachine(2), EntityId.forMachine(1)),
        inserter(10, belt, EntityId.forMachine(1)),
        { entity_id: EntityId.forDrill(1), sink_id: EntityId.forMachine(1) },
    ];
    const registry = {
        getEntityById: (id: EntityId) => entities.find(entity => entity.entity_id.id === id.id) ?? null,
    } as unknown as ReadableEntityRegistry;
    const header = (ids: EntityId[], kind?: string) => entityDescriptionHeaderLines(ids, registry, "[item=jelly]", kind);

    it("names the recipe of the machine an inserter fills", () => {
        expect(header([EntityId.forInserter(3)])).toEqual(["Inserter 3 for [item=jelly] into [recipe=jellynut-processing]"]);
    });

    it("names the recipe of the machine an inserter empties", () => {
        expect(header([EntityId.forInserter(2)])).toEqual(["Inserter 2 for [item=jelly] from [recipe=rocket-fuel-from-jelly]"]);
    });

    it("names both recipes of an inserter between two machines", () => {
        expect(header([EntityId.forInserter(6)]))
            .toEqual(["Inserter 6 for [item=jelly] from [recipe=jellynut-processing] into [recipe=rocket-fuel-from-jelly]"]);
    });

    it("lists the inserters sharing a combinator in one line when their machines have the same recipe", () => {
        expect(header([EntityId.forInserter(10), EntityId.forInserter(1)], "fuel"))
            .toEqual(["Inserters 1, 10 for [item=jelly] into [recipe=rocket-fuel-from-jelly] (fuel)"]);
    });

    it("gives each recipe a line when the inserters sharing a combinator work with different machines", () => {
        expect(header([EntityId.forInserter(10), EntityId.forInserter(3), EntityId.forInserter(1)])).toEqual([
            "Inserters 1, 3, 10 for [item=jelly]",
            "- 1, 10: into [recipe=rocket-fuel-from-jelly]",
            "- 3: into [recipe=jellynut-processing]",
        ]);
    });

    it("names the recipe of the machine a drill fills", () => {
        expect(header([EntityId.forDrill(1)])).toEqual(["Drill 1 for [item=jelly] into [recipe=rocket-fuel-from-jelly]"]);
    });
});

describe("combinator descriptions of the rocket fuel biochambers", async () => {
    const quiet = { log() {}, warn() {}, error() {}, debug() {} };
    const result = generateClockForConfig(await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL), { logger: quiet });
    const first_lines = (result.blueprint.entities ?? [])
        .map(entity => (entity.player_description ?? "").split("\n")[0])
        .filter(line => line.startsWith("Inserter"));

    it("name the recipes of the machines of every inserter", () => {
        expect(first_lines.sort()).toEqual([
            "Inserter 11 for [item=jellynut-seed] from [recipe=jellynut-processing] (by-product)",
            "Inserter 12 for [item=nutrients] into [recipe=jellynut-processing] (fuel)",
            "Inserter 3 for [item=jellynut] into [recipe=jellynut-processing]",
            "Inserters 1, 5 for [item=bioflux] into [recipe=rocket-fuel-from-jelly]",
            "Inserters 10, 13 for [item=nutrients] into [recipe=rocket-fuel-from-jelly] (fuel)",
            "Inserters 2, 4 for [item=rocket-fuel] from [recipe=rocket-fuel-from-jelly]",
            "Inserters 6, 7, 8, 9 for [item=jelly] from [recipe=jellynut-processing] into [recipe=rocket-fuel-from-jelly]",
        ]);
    });
});
