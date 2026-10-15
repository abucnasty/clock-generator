import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { describe, expect, it } from "vitest";
import { ruleCount } from "../crafting/rule-count";
import { ExtractorDump, ExtractorDumpInserter, expandChanges, readExtractorDump } from "./extractor-dump";

/**
 * The fixtures are cuts (scripts/cut-extractor-dump.js) of two dumps of the inserter cost series' 48-belt automation
 * science build, which makes two products a craft with productivity: 800 samples of three science assemblers with their
 * copper plate, gear and science pack inserters, and the belt-fed calcite inserter of an ore-melting foundry. The
 * unwired one is bm_role_b_no_circuit, the clocked one bm_role_a_all_clocked (every inserter but the calcite one is on
 * a circuit condition). `*.expected.json` is the output of the series' fuller.py (closing/recount-2a), run unchanged on
 * the fixtures.
 */
const FIXTURES = path.join(__dirname, "fixtures");
const UNWIRED = path.join(FIXTURES, "automation-science-unwired");
const CLOCKED = path.join(FIXTURES, "automation-science-clocked");

const inserterOf = (dump: ExtractorDump, id: string): ExtractorDumpInserter => {
    const inserter = dump.inserters.find(i => i.inserter_id === id);
    if (inserter === undefined) {
        throw new Error(`no inserter ${id} in ${dump.source}`);
    }
    return inserter;
};
const machineOf = (dump: ExtractorDump, id: string) => {
    const machine = dump.machines.find(m => m.machine_id === id);
    if (machine === undefined) {
        throw new Error(`no machine ${id} in ${dump.source}`);
    }
    return machine;
};

describe("expandChanges", () => {
    it("holds the last change at or before each index, the initial value before the first", () => {
        expect(expandChanges([2, 5, 4, 7], 6, 1)).toEqual([1, 1, 5, 5, 7, 7]);
        expect(expandChanges([0, 3], 3, 9)).toEqual([3, 3, 3]);
        expect(expandChanges(undefined, 3, 9)).toEqual([9, 9, 9]);
    });

    it("ignores changes at or after the length and truncates to whole numbers as the series does", () => {
        expect(expandChanges([1, 2.9, 5, 8], 3, 0.5)).toEqual([0, 2, 2]);
    });
});

describe("readExtractorDump of the unwired automation science fixture", () => {
    it("has the samples of its header and the entities with samples", async () => {
        const dump = await readExtractorDump(UNWIRED);
        expect(dump.source).toBe("automation-science-unwired");
        expect(dump.ticks).toBe(800);
        expect(dump.minutes).toBeCloseTo(799 / 3600, 12);
        expect(dump.inserters).toHaveLength(10);
        expect(dump.machines).toHaveLength(10);
        for (const inserter of dump.inserters) {
            expect(inserter.states).toHaveLength(800);
            expect(inserter.held).toHaveLength(800);
        }
        for (const machine of dump.machines) {
            expect(machine.products_finished).toHaveLength(800);
            expect(machine.working).toHaveLength(800);
        }
    });

    it("reads a science output inserter: from its assembler onto a belt, the hand of the dump at the start", async () => {
        const dump = await readExtractorDump(UNWIRED);
        const output = inserterOf(dump, "117544");
        // raw lines: "pt":117545 (assembling-machine-3, recipe automation-science-pack), "dt":117542 (a transport belt),
        // "h":["automation-science-pack",16,"normal"], no "w"; samples "s":[0,36,119,1,127,36,...], "h":[0,16,1,12,43,8,...]
        expect(output).toMatchObject({
            source_kind: "machine",
            sink_kind: "belt",
            source_machine_id: "117545",
            sink_machine_id: null,
            source_recipe: "automation-science-pack",
            sink_recipe: "",
            items: ["automation-science-pack"],
            wired: false,
        });
        expect(output.states[0]).toBe("waiting_for_space_in_destination");
        expect(output.states[118]).toBe("waiting_for_space_in_destination");
        expect(output.states[119]).toBe("working");
        expect(output.states[126]).toBe("working");
        expect(output.states[127]).toBe("waiting_for_space_in_destination");
        expect(output.held.slice(0, 3)).toEqual([16, 12, 12]);
        expect(output.held[43]).toBe(8);
        expect(output.held[85]).toBe(4);
    });

    it("reads a copper plate input: from a foundry into the assembler, its item from the samples alone", async () => {
        const dump = await readExtractorDump(UNWIRED);
        const input = inserterOf(dump, "117547");
        // raw: "pt":117480 (foundry, recipe casting-copper), "dt":117545; no "h"; "it":[260,"copper-plate"],
        // "s":[0,36,259,34,260,1,264,36,...]
        expect(input).toMatchObject({
            source_kind: "machine",
            sink_kind: "machine",
            source_machine_id: "117480",
            sink_machine_id: "117545",
            source_recipe: "casting-copper",
            sink_recipe: "automation-science-pack",
            items: ["copper-plate"],
            wired: false,
        });
        expect(input.states[258]).toBe("waiting_for_space_in_destination");
        expect(input.states[259]).toBe("waiting_for_source_items");
        expect(input.states[260]).toBe("working");
        expect(input.states[264]).toBe("waiting_for_space_in_destination");
        expect(input.held[0]).toBe(0);
    });

    it("reads the gear input of the same assembler from the other foundry", async () => {
        const dump = await readExtractorDump(UNWIRED);
        expect(inserterOf(dump, "117794")).toMatchObject({
            source_machine_id: "117844",
            sink_machine_id: "117545",
            source_recipe: "casting-iron-gear-wheel",
            items: ["iron-gear-wheel"],
        });
    });

    it("reads the belt-fed calcite inserter: a belt source, and the foundry it feeds as the sink", async () => {
        const dump = await readExtractorDump(UNWIRED);
        const calcite = inserterOf(dump, "118739");
        // raw: "pt":118741 (a transport belt), "dt":118999 (foundry, recipe copper-ore-melting), "it":[182,"calcite"]
        expect(calcite).toMatchObject({
            source_kind: "belt",
            sink_kind: "machine",
            source_machine_id: null,
            sink_machine_id: "118999",
            source_recipe: "",
            sink_recipe: "copper-ore-melting",
            items: ["calcite"],
            wired: false,
        });
        expect(calcite.states[180]).toBe("waiting_for_space_in_destination");
        expect(calcite.states[181]).toBe("waiting_for_source_items");
        expect(calcite.states[182]).toBe("working");
    });

    it("reads a foundry's products finished from its initial value and its working status", async () => {
        const dump = await readExtractorDump(UNWIRED);
        const foundry = machineOf(dump, "117480");
        // raw: "pf":12482 at the start, samples "pf":[0,12482,260,12485,261,12487,...], "s":[0,29,260,1,267,29,...]
        expect(foundry.recipe).toBe("casting-copper");
        expect(foundry.products_finished[0]).toBe(12482);
        expect(foundry.products_finished[259]).toBe(12482);
        expect(foundry.products_finished[260]).toBe(12485);
        expect(foundry.products_finished[261]).toBe(12487);
        expect(foundry.working[259]).toBe(false);
        expect(foundry.working[260]).toBe(true);
        expect(foundry.working[266]).toBe(true);
        expect(foundry.working[267]).toBe(false);
        expect(machineOf(dump, "117545").recipe).toBe("automation-science-pack");
    });
});

describe("readExtractorDump of the clocked automation science fixture", () => {
    it("reads an inserter on a circuit condition as wired, disabled where the samples say 59", async () => {
        const dump = await readExtractorDump(CLOCKED);
        const input = inserterOf(dump, "117547");
        // raw: "w":[{"c":2,"net":6,...}] and "cb":{"circuit_enable_disable":true,...}; "s":[0,59,19,34,20,1,24,36,...]
        expect(input.wired).toBe(true);
        expect(input.states[0]).toBe("disabled_by_control_behavior");
        expect(input.states[18]).toBe("disabled_by_control_behavior");
        expect(input.states[19]).toBe("waiting_for_source_items");
        expect(input.states[20]).toBe("working");
    });

    it("takes the items of an inserter without a hand in its static entity from its samples", async () => {
        const dump = await readExtractorDump(CLOCKED);
        // raw: no "h" on the entity, "it":[7,"automation-science-pack"], "s":[0,59,6,34,7,1,11,36,...]
        const output = inserterOf(dump, "127839");
        expect(output.items).toEqual(["automation-science-pack"]);
        expect(output.held[0]).toBe(0);
        expect(output.wired).toBe(true);
        expect(output.states[5]).toBe("disabled_by_control_behavior");
        expect(output.states[6]).toBe("waiting_for_source_items");
        expect(output.states[7]).toBe("working");
    });

    it("keeps the calcite inserter unwired", async () => {
        const dump = await readExtractorDump(CLOCKED);
        expect(inserterOf(dump, "118739").wired).toBe(false);
    });
});

describe("readExtractorDump groups the inserters as the series does", () => {
    // fuller.py's group key: source kind to sink kind, items, source recipe > sink recipe, wired
    const keyOf = (i: ExtractorDumpInserter) => [
        `${i.source_kind} to ${i.sink_kind}`, i.items.join("+") || "-", `${i.source_recipe} > ${i.sink_recipe}`,
        i.wired ? "wired" : "unwired",
    ].join(" | ");

    for (const [name, base] of [["unwired", UNWIRED], ["clocked", CLOCKED]]) {
        it(`gives the groups and the sizes of fuller.py's output on the ${name} fixture`, async () => {
            const dump = await readExtractorDump(base);
            const expected = JSON.parse(fs.readFileSync(`${base}.expected.json`, "utf8"));
            const counts = new Map<string, number>();
            for (const inserter of dump.inserters) {
                counts.set(keyOf(inserter), (counts.get(keyOf(inserter)) ?? 0) + 1);
            }
            const expected_counts = new Map<string, number>(expected.groups.map((g: any) => [
                [g.role, g.items, g.recipes, g.wiring].join(" | "), g.inserters,
            ]));
            expect(counts).toEqual(expected_counts);
            expect(dump.ticks).toBe(expected.ticks);
            expect(dump.minutes).toBe(expected.minutes);
        });
    }

    // The count laid against fuller.py on a productivity machine (two products a craft): source, sink and pickup
    // wake-ups of every group, the minutes and the machines whose starts fall back to their finishes
    for (const [name, base] of [["unwired", UNWIRED], ["clocked", CLOCKED]] as const) {
        it(`the count agrees with fuller.py's e_src_g, e_dst_g and e_pick_g on every group of the ${name} fixture`, async () => {
            const dump = await readExtractorDump(base);
            const run = ruleCount(dump.inserters, dump.machines, 0, dump.ticks);
            const expected = JSON.parse(fs.readFileSync(`${base}.expected.json`, "utf8"));
            const theirs = new Map<string, { n: number; src: number; dst: number; pick: number }>();
            for (const g of expected.groups) {
                const key = `${g.role} | ${g.items} | ${g.recipes}`;
                const e = theirs.get(key) ?? { n: 0, src: 0, dst: 0, pick: 0 };
                theirs.set(key, { n: e.n + g.inserters, src: e.src + (g.e_src_g ?? 0), dst: e.dst + (g.e_dst_g ?? 0), pick: e.pick + (g.e_pick_g ?? 0) });
            }
            const ours = new Map(run.groups.map(g => [g.key, { n: g.inserters, src: g.source_wake_ups, dst: g.sink_wake_ups, pick: g.pickups }]));
            expect(ours).toEqual(theirs);
            expect(run.minutes).toBeCloseTo(expected.minutes, 12);
            const fallback: Record<string, number> = {};
            for (const m of run.start_rule_fallback) {
                fallback[m.recipe] = (fallback[m.recipe] ?? 0) + 1;
            }
            const their_fallback: Record<string, number> = {};
            for (const [machine, count] of Object.entries(expected.start_rule_fallback as Record<string, number>)) {
                const recipe = machine.split(" ").slice(1).join(" ");
                their_fallback[recipe] = (their_fallback[recipe] ?? 0) + count;
            }
            expect(fallback).toEqual(their_fallback);
        });
    }
});

describe("readExtractorDump of gzipped files", () => {
    it("reads the same dump from .gz copies", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "extractor-dump-"));
        try {
            for (const suffix of ["static", "samples"]) {
                const content = fs.readFileSync(`${UNWIRED}.${suffix}.ndjson`);
                fs.writeFileSync(path.join(directory, `zipped.${suffix}.ndjson.gz`), zlib.gzipSync(content));
            }
            const zipped = await readExtractorDump(path.join(directory, "zipped"));
            const plain = await readExtractorDump(UNWIRED);
            expect({ ...zipped, source: "" }).toEqual({ ...plain, source: "" });
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe("readExtractorDump infers the true starts of a machine that has a crafting speed and a recipe record", () => {
    // the fixtures are cuts without recipe records (k "r"), which the series' dumps hold; one is added to a copy
    const RECIPE_RECORD = '{"k":"r","n":"automation-science-pack","energy":5,"prod":[{"name":"automation-science-pack","amount":1}],"pb":0,"max_pb":3}\n';
    const SCIENCE_ASSEMBLER = "117545";
    const FOUNDRY = "117480";

    it("names a machine without a recipe record, with the reason, and gives it no true starts", async () => {
        const dump = await readExtractorDump(UNWIRED);
        for (const machine of dump.machines) {
            expect(machine.crafting).toBeNull();
            expect(machine.true_starts).toBeUndefined();
            expect(machine.no_params_reason).toBe("no recipe record");
        }
        expect(machineOf(dump, SCIENCE_ASSEMBLER).name).toBe("assembling-machine-3");
    });

    it("reads delta, the productivity bonus and the diagnostics, and sets true_starts, where the record is", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "extractor-dump-"));
        try {
            fs.writeFileSync(path.join(directory, "with-recipe.static.ndjson"),
                fs.readFileSync(`${UNWIRED}.static.ndjson`, "utf8") + RECIPE_RECORD);
            fs.copyFileSync(`${UNWIRED}.samples.ndjson`, path.join(directory, "with-recipe.samples.ndjson"));
            const dump = await readExtractorDump(path.join(directory, "with-recipe"));
            const assembler = machineOf(dump, SCIENCE_ASSEMBLER);
            // crafting speed 56.484375, energy 5; the entity's productivity 1 and the recipe's 0
            expect(assembler.no_params_reason).toBeNull();
            expect(assembler.crafting?.crafting_speed).toBe(56.484375);
            expect(assembler.crafting?.delta).toBe(56.484375 / 300);
            expect(assembler.crafting?.productivity_bonus).toBe(1);
            expect(assembler.crafting?.diag).toMatchObject({ resync: expect.any(Number), miss: expect.any(Number) });
            expect(assembler.crafting?.craft_out_count).toBeGreaterThan(0);
            expect(assembler.true_starts).toHaveLength(800);
            expect(assembler.true_starts![0]).toBe(false);
            expect(assembler.true_starts!.filter(Boolean).length).toBeGreaterThan(0);
            // the foundry's recipe has no record
            expect(machineOf(dump, FOUNDRY).true_starts).toBeUndefined();
            expect(machineOf(dump, FOUNDRY).no_params_reason).toBe("no recipe record");
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
