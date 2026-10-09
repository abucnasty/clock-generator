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
    const assembler = { recipe: "iron-gear-wheel", type: "machine" };

    it("says what is missing when the sidecar did not say its version and there is a biochamber recipe", () => {
        const guidance = Option.toNullable(checkSidecarImport(undefined, [biochamber]));
        expect(guidance).toBe(
            `This was exported by an older Clock Generator Sidecar. `
            + `The energy consumption of biochambers is not exported, so it has to be set on each biochamber by hand. `
            + `Update the mod to ${LATEST_SIDECAR_VERSION} to import everything automatically.`,
        );
    });

    it("names the version of an older sidecar", () => {
        expect(Option.toNullable(checkSidecarImport("0.3.0", [biochamber]))).toContain("Clock Generator Sidecar 0.3.0.");
    });

    it("only says that nothing is affected when nothing in the data needs what the sidecar lacks", () => {
        const guidance = Option.toNullable(checkSidecarImport("0.3.0", [assembler]));
        expect(guidance).toContain("Nothing in this import is affected");
        expect(guidance).not.toContain("energy consumption");
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

    it("is not older than the version of the project", () => {
        for (const version of [readVersion("clock-generator", "package.json"), readVersion("clock-generator-ui", "package.json")]) {
            expect(compareVersions(LATEST_SIDECAR_VERSION, version)).toBeGreaterThanOrEqual(0);
        }
    });
});
