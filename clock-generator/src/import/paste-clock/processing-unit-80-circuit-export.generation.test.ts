import * as fs from "fs";
import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FactorioData } from "../../data/factorio-data-types";
import type { ImportInputs } from "../index";
import { pasteClock, type IdMap, type LeftOut, type PasteClockRun, type Point, type ReadFile, type RecordedClock, type SampleFile } from "./paste-clock-helpers";

const ENGINE = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(file, "utf8");

const BUILD = "processing-unit-80-circuit-export";
type Case = { scaffold: string; sample: string; record: string; translation: Point; research: ImportInputs["research"]; id_map: IdMap; left_out: LeftOut; answers: Record<string, string>; read: ReadFile };
const sampleCase = JSON.parse(read(path.join(__dirname, "cases", `${BUILD}.json`))) as Case;
const MOVES = JSON.parse(read(path.join(__dirname, "moves.json"))) as Record<string, { direction: string; cause: string }>;
const RECORD = JSON.parse(read(path.join(ENGINE, "record", `${sampleCase.record}.json`))) as RecordedClock;
const SAMPLE = JSON.parse(read(path.join(ENGINE, sampleCase.sample))) as SampleFile;

describe("a pasted blueprint of the processing unit 80 circuit export sample", () => {
    let run: PasteClockRun;

    beforeAll(async () => {
        run = await pasteClock({
            name: BUILD,
            text: read(path.join(ENGINE, sampleCase.scaffold)).trim(),
            data: JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as FactorioData,
            source: sampleCase.read,
            positioned: sampleCase.read,
            translation: sampleCase.translation,
            research: sampleCase.research,
            sample: SAMPLE,
            units: 1,
            leftOut: sampleCase.left_out,
            answers: sampleCase.answers,
            idMap: sampleCase.id_map,
            record: RECORD,
        });
    });

    it("holds one unit of the sample and has every question answered by the file", () => {
        expect(run.unitsFound).toBe(1);
        expect(run.settled.unanswered).toEqual([]);
    });

    it("pairs every entity with the sample's by the id map, but those it leaves out", () => {
        expect(run.pairing.failures).toEqual([]);
        expect(run.pairing.leftOut).toEqual({ machine: [], drill: [], inserter: [], chest: [], ...sampleCase.left_out });
    });

    it("leaves out the four throttles and their chests, and gives the circuit belt the sample's export: 40 an item a second on each lane, no end", () => {
        const outcome = run.settled.outcome;
        const belt = outcome.belts.find((b) => b.lanes.every((l) => l.ingredient === "electronic-circuit"));
        expect(belt?.strategy).toBe("export");
        expect(belt?.lanes.map((l) => [(l as { consumption_per_second?: number }).consumption_per_second, l.lane_end])).toEqual([[40, undefined], [40, undefined]]);
        expect(outcome.inserters).toHaveLength(24 + sampleCase.left_out.inserter!.length);
        expect(outcome.chests).toHaveLength(sampleCase.left_out.chest!.length);
    });

    it("takes the sample's productivities: 150 for casting and electronic circuits, 175 for advanced circuits and 300 for processing units", () => {
        const machines = run.settled.outcome.machines;
        for (const m of machines) {
            const theirs = SAMPLE.machines!.find((s) => s.id === sampleCase.id_map.machine![String(m.id)])!;
            expect(m.productivity, `machine ${m.id}`).toBe(theirs.productivity);
        }
        expect([...new Set(machines.map((m) => m.productivity))].sort((a, b) => a - b)).toEqual([150, 175, 300]);
    });

    it("generates a clock", () => {
        expect(run.error).toBeNull();
        expect(run.summary).not.toBeNull();
    });

    it("selects the record's clock: its id, verdict, rate and window cycle", () => {
        const recorded = RECORD.alternatives.find((a) => a.id === RECORD.selected)!;
        expect({ id: run.summary?.id, verdict: run.summary?.verdict, rate: run.summary?.rate, window_cycle_ticks: run.summary?.window_cycle_ticks })
            .toEqual({ id: recorded.id, verdict: recorded.verdict, rate: recorded.rate, window_cycle_ticks: recorded.window_cycle_ticks });
    });

    it("is the record's clock, or moves in the way moves.json says", () => {
        const state = run.comparison?.state;
        if (state === "moved") {
            expect(MOVES[BUILD], "moves.json has no entry for this build").toBeDefined();
            expect(run.direction).toBe(MOVES[BUILD].direction);
        } else {
            expect(MOVES[BUILD], "moves.json has an entry for a build that is not moved").toBeUndefined();
            expect(["equal", "equal under the id map"], run.comparison?.differences.join("; ")).toContain(state);
        }
    });
});
