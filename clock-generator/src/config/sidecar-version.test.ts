import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FactorioDataService } from "../data/factorio-data-service";
import { Option } from "../data-types/option";
import { ImportPipeline } from "./import-pipeline";
import { checkSidecarImport, compareVersions, ENERGY_CONSUMPTION_FEATURE, LATEST_SIDECAR_VERSION, SidecarFeature, sidecarFeatureStep } from "./sidecar-version";

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

describe("compareVersions", () => {
    it("compares every part as a number", () => {
        expect(compareVersions("0.3.0", "0.4.0")).toBeLessThan(0);
        expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
        expect(compareVersions("1.0", "1.0.0")).toBe(0);
    });
});

describe("checkSidecarImport", () => {
    const biochamber = { recipe: "nutrients-from-yumako-mash", type: "machine" };

    it("says what is missing when the sidecar did not say its version and there is a biochamber recipe", () => {
        const guidance = Option.toNullable(checkSidecarImport(undefined, [biochamber]));
        expect(guidance).toBe(
            `This was exported by an older Clock Generator Sidecar. `
            + `The energy consumption of biochambers is not exported, so it has to be set on each biochamber by hand. `
            + `Each machine's kind (a furnace, a biochamber or another) was exported, not the machine, so each got a machine `
            + `of its kind that can make its recipe: check each machine. `
            + `Update the mod to ${LATEST_SIDECAR_VERSION} to import everything automatically.`,
        );
    });

    it("names the version of an older sidecar", () => {
        expect(Option.toNullable(checkSidecarImport("0.3.0", [biochamber]))).toContain("Clock Generator Sidecar 0.3.0.");
    });

    it("says that nothing is missing, and only offers the update, when nothing in the data needs what the sidecar lacks", () => {
        const guidance = Option.toNullable(checkSidecarImport("0.6.0", []));
        expect(guidance).toBe(
            "This was exported by Clock Generator Sidecar 0.6.0. Nothing is missing from this import. "
            + `You can update the mod to ${LATEST_SIDECAR_VERSION} when you like.`,
        );
        expect(guidance).not.toContain("energy consumption");
        expect(guidance).not.toContain("affected");
        expect(guidance).not.toContain("import everything automatically");
    });

    it("has nothing to say about the latest version", () => {
        expect(checkSidecarImport(LATEST_SIDECAR_VERSION, [biochamber])).toEqual(Option.none());
    });

    it("folds what several features lack into one message that asks for the update once", () => {
        const second: SidecarFeature = { name: "second", since: "9.0.0", appliesTo: () => true, missing: () => "The second is not exported." };
        const pipeline = ImportPipeline.of(...[ENERGY_CONSUMPTION_FEATURE, second].map(sidecarFeatureStep));
        const guidance = Option.toNullable(checkSidecarImport("0.3.0", [biochamber], pipeline))!;
        expect(guidance).toContain("biochambers is not exported");
        expect(guidance).toContain("The second is not exported.");
        expect(guidance.match(/Update the mod/g)).toHaveLength(1);
    });
});

describe("sidecarFeatureStep", () => {
    const feature: SidecarFeature = {
        name: "example",
        since: "1.2.0",
        appliesTo: input => input.machines.length > 0,
        missing: () => "It lacks the example.",
    };
    const machines = [{ recipe: "iron-gear-wheel" }];

    it("has nothing to say from the version that exports the feature", () => {
        expect(sidecarFeatureStep(feature)({ sidecar_version: "1.2.0", machines })).toEqual(Option.none());
    });

    it("has nothing to say when nothing in the data needs the feature", () => {
        expect(sidecarFeatureStep(feature)({ sidecar_version: null, machines: [] })).toEqual(Option.none());
    });

    it("says what is missing before that version", () => {
        expect(sidecarFeatureStep(feature)({ sidecar_version: "1.1.0", machines })).toEqual(Option.some("It lacks the example."));
    });
});

describe("sidecar version convention", () => {
    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const readVersion = (...file: string[]) => JSON.parse(fs.readFileSync(path.join(projectRoot, ...file), "utf8")).version as string;

    it("is the version of the sidecar mod", () => {
        expect(readVersion("clock-generator-sidecar", "info.json")).toBe(LATEST_SIDECAR_VERSION);
    });

    it("is the version of the newest entry in the sidecar changelog", () => {
        const changelog = fs.readFileSync(path.join(projectRoot, "clock-generator-sidecar", "changelog.txt"), "utf8");
        expect(changelog.match(/^Version: (\S+)/m)?.[1]).toBe(LATEST_SIDECAR_VERSION);
    });
});

it('asks older sidecar imports with infinity chests to review settings, without guessing the missing flag', () => {
    const chests = [{ type: 'infinity-chest', id: 1, item_filter: [{ item_name: 'iron-plate', request_count: 200 }] }];
    expect(Option.toNullable(checkSidecarImport('0.7.1', [], undefined, chests))).toContain('Remove unfiltered items was not exported');
    expect(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, chests)).toEqual(Option.none());
    expect(chests[0]).not.toHaveProperty('remove_unfiltered_items');
});

it('asks older belt imports to re-export pickup geometry rather than silently claiming it is modelled', () => {
    const inserters = [{ source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } }];
    expect(Option.toNullable(checkSidecarImport('0.8.0', [], undefined, [], inserters))).toContain('Physical belt pickup geometry was not exported');
    expect(Option.toNullable(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [], inserters))).toContain('classification was not captured');
});


it('accepts an explicit current capture declaration without asking for a mod update', () => {
    const inserters = [{source: {type: 'belt', id: 1, pickup_length: 1, near_lane: 1,
        pickup_capture: {status: 'supported', model: 'belt', model_version: 1, entity_type: 'transport-belt'}},
        prototype: 'stack-inserter', quality: 'legendary'}];
    expect(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [], inserters)).toEqual(Option.none());
});

it('requires layout recapture even when an old underground export names the current mod version', () => {
    const source = {type: 'belt', id: 1, pickup_length: 0.5, near_lane: 1,
        pickup_capture: {status: 'supported', model: 'belt', model_version: 1, entity_type: 'underground-belt'}};
    const identity = {prototype: 'stack-inserter', quality: 'legendary'};
    expect(Option.toNullable(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [], [{source, ...identity}]))).toContain('Underground pickup layout was not captured');
    expect(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [], [{source: {...source, pickup_layout: 'front-entrance',
        pickup_capture: {...source.pickup_capture, model_version: 2}}, ...identity}])).toEqual(Option.none());
});

describe('an older capture without inserter identity', () => {
    const capture = { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 16 };
    const recapture = 'Inserter kind, quality and filter mode were not exported, so every inserter is read as a legendary stack inserter';

    it('is asked to recapture, whatever its inserters take from', () => {
        for (const version of [undefined, '0.6.0', '0.10.0']) {
            const guidance = Option.toNullable(checkSidecarImport(version, [], undefined, [], [capture]))!;
            expect(guidance).toContain(recapture);
            expect(guidance).toContain('Update Sidecar and recapture these inputs');
        }
    });

    it('is told apart from a capture of legendary stack inserters, which says what it is', () => {
        const identified = { ...capture, prototype: 'stack-inserter', quality: 'legendary' };
        expect(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [], [identified])).toEqual(Option.none());
        expect(Option.toNullable(checkSidecarImport('0.10.0', [], undefined, [], [capture]))).toContain(recapture);
    });

    it('is asked to recapture by what it holds, even when it names the current version', () => {
        // development builds of Sidecar 0.11.0 exported no prototype either
        expect(Option.toNullable(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [], [capture]))).toContain(recapture);
        expect(Option.toNullable(checkSidecarImport(LATEST_SIDECAR_VERSION, [], undefined, [],
            [{ ...capture, prototype: 'stack-inserter', quality: 'legendary' }, capture]))).toContain(recapture);
    });

    it('is not asked to recapture when an older version says what each inserter is', () => {
        const identified = { ...capture, prototype: 'fast-inserter', quality: 'normal' };
        expect(Option.toNullable(checkSidecarImport('0.10.0', [], undefined, [], [identified]))).not.toContain(recapture);
    });

    it('has nothing to recapture when the export holds no inserter', () => {
        expect(Option.toNullable(checkSidecarImport('0.10.0', [{ recipe: 'iron-gear-wheel' }]))).not.toContain(recapture);
    });
});

it("tells a paste with drills from a sidecar before 0.12.0 that the drills' productivity modules are not in it", () => {
    const drills = [{ id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 70, target: { type: 'chest', id: 1 } }];
    expect(Option.toNullable(checkSidecarImport('0.11.0', [], undefined, [], [], drills))).toContain("productivity modules were not exported");
    expect(Option.toNullable(checkSidecarImport('0.11.0', [], undefined, [], [], []))).not.toContain('productivity modules');
    expect(checkSidecarImport('0.12.0', [], undefined, [], [], drills)).toEqual(Option.none());
});
