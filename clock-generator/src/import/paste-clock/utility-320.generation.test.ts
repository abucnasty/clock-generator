import * as fs from "fs";
import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FactorioData } from "../../data/factorio-data-types";
import type { ImportInputs } from "../index";
import { pasteClock, type LeftOut, type PasteClockRun, type Point, type ReadFile, type RecordedClock, type SampleFile } from "./paste-clock-helpers";

const ENGINE = path.resolve(__dirname, "../../..");
const FIXTURES = path.join(ENGINE, "src", "import", "fixtures", "assemble");
const read = (file: string) => fs.readFileSync(file, "utf8");

const BUILD = "utility-320";
const RECORD = "config-UTILITY_SCIENCE_320_METERED_TAKERS";
const UNITS = 1;
const LEFT_OUT: LeftOut = {};

type Tier1Build = { name: string; blueprint: string; read: string; read_kind: string; frame: { translation: Point }; research: ImportInputs["research"] };
const build = (JSON.parse(read(path.join(FIXTURES, "tier1.json"))) as { builds: Tier1Build[] }).builds.find((b) => b.name === BUILD)!;

describe("a pasted blueprint of the utility science 320 sample", () => {
    let run: PasteClockRun;

    beforeAll(async () => {
        const sampleFile = path.join(ENGINE, build.blueprint.replace(/\.scaffold$/, ".json"));
        const positioned = JSON.parse(read(path.join(FIXTURES, build.read))) as ReadFile;
        run = await pasteClock({
            name: BUILD,
            text: read(path.join(ENGINE, build.blueprint)).trim(),
            data: JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as FactorioData,
            source: build.read_kind === "config" ? (JSON.parse(read(sampleFile)) as ReadFile) : positioned,
            positioned,
            translation: build.frame.translation,
            research: build.research,
            sample: JSON.parse(read(sampleFile)) as SampleFile,
            units: UNITS,
            leftOut: LEFT_OUT,
            record: JSON.parse(read(path.join(ENGINE, "record", `${RECORD}.json`))) as RecordedClock,
        });
    });

    it("holds the units of the sample and has every question answered by the file", () => {
        expect(run.unitsFound).toBe(UNITS);
        expect(run.settled.unanswered).toEqual([]);
    });

    it("generates a clock", () => {
        expect(run.error).toBeNull();
        expect(run.summary).not.toBeNull();
    });

    it("selects a clock for the whole build", () => {
        expect(run.summary?.verdict).toBeDefined();
    });
});
