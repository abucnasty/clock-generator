import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "./config-paths";
import { parseConfig } from "./loader";
import { migrateBeltSupplyOverrides } from "./migrate-belt-supply";
import { migrateBlockedSlotFilter } from "./migrate-blocked-slots";
import { migrateChestType } from "./migrate-chest-type";
import { migrateMachineType } from "./migrate-machine-type";
import { migrateMiningProductivityLevel } from "./migrate-mining-productivity";
import { normalizePickupCaptureConfig } from "./pickup-capture";

type Raw = Record<string, unknown>;

const ENGINE = path.resolve(__dirname, "../..");
const LEGACY = path.join(__dirname, "fixtures", "legacy");
const object = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const each = (list: unknown, step: (value: unknown) => unknown) => Array.isArray(list) ? list.map(step) : list;
const at = (config: Raw, key: string, step: (value: unknown) => unknown): Raw => key in config ? { ...config, [key]: step(config[key]) } : config;

/**
 * Every load-time migration of a config, applied where the loader and the schema apply it, without the schema's checks
 * or defaults; by the name of its legacy fixture in fixtures/legacy/. A config in the current shape is left as it is.
 */
const MIGRATIONS: Record<string, (config: Raw) => Raw> = {
    "chest-without-type": config => at(config, "chests", chests => each(chests, migrateChestType)),
    "pickup-without-capture": config => normalizePickupCaptureConfig(config) as Raw,
    "machine-type": config => at(config, "machines", machines => each(machines, machine => migrateMachineType(machine))),
    "mining-productivity-level": config => at(config, "drills", drills => migrateMiningProductivityLevel(drills)),
    "blocked-slot-item": config => at(config, "chests", chests => each(chests, chest =>
        object(chest) ? at(chest, "slot_filters", filters => each(filters, migrateBlockedSlotFilter)) : chest)),
    "non-moving-belts": config => at(config, "overrides", migrateBeltSupplyOverrides),
};

/** The schema's preprocess steps that MIGRATIONS holds (`z.preprocess(<step>, ...)` in schema.ts) */
const SCHEMA_STEPS = ["normalizePickupCaptureConfig", "migrateMachineTypeStep", "migrateMiningProductivityLevelStep",
    "migrateBlockedSlotFilter", "migrateBeltSupplyOverrides"];

const migrated = (config: Raw) => Object.values(MIGRATIONS).reduce((value, step) => step(value), config);
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Raw;

/** Every config the repository keeps as a sample: the config samples and the game tests' fixture configs */
function sampleConfigs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === ".scratch" || entry.name === "node_modules" ? [] : sampleConfigs(file);
        if (!entry.name.endsWith(".json")) return [];
        const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        return object(value) && Array.isArray(value.machines) && object(value.target_output) ? [file] : [];
    });
}

const SAMPLES = [...sampleConfigs(path.join(ENGINE, "resources", "config-samples")), ...sampleConfigs(path.join(ENGINE, "tests", "game"))];

describe("the load-time migrations", () => {
    it("are every preprocess step of the schema", () => {
        const schema = fs.readFileSync(path.join(__dirname, "schema.ts"), "utf8");
        const steps = Array.from(schema.matchAll(/z\.preprocess\((\w+)/g), match => match[1]);
        // a new step belongs in MIGRATIONS, with a legacy fixture, so that the samples are held to it too
        expect(steps.sort()).toEqual([...SCHEMA_STEPS].sort());
    });

    it("each have one legacy fixture, which only that migration changes", () => {
        expect(fs.readdirSync(LEGACY).sort()).toEqual(Object.keys(MIGRATIONS).map(name => `${name}.json`).sort());
        for (const [name, step] of Object.entries(MIGRATIONS)) {
            const fixture = read(path.join(LEGACY, `${name}.json`));
            expect(step(fixture), name).not.toEqual(fixture);
            for (const [other, otherStep] of Object.entries(MIGRATIONS)) {
                if (other !== name) expect(otherStep(fixture), `${other} on ${name}`).toEqual(fixture);
            }
        }
    });

    it.each(Object.keys(MIGRATIONS))("read %s as the loader does: the migrated fixture loads to the same config", async name => {
        const text = fs.readFileSync(path.join(LEGACY, `${name}.json`), "utf8");
        const current = migrated(JSON.parse(text));
        expect(migrated(current)).toEqual(current);
        expect(await parseConfig(JSON.stringify(current))).toEqual(await parseConfig(text));
    });
});

describe("the samples", () => {
    it("are every config of ConfigPaths and the game fixtures", () => {
        expect(SAMPLES).toEqual(expect.arrayContaining(Object.values(ConfigPaths)));
        expect(SAMPLES.length).toBeGreaterThan(Object.values(ConfigPaths).length);
    });

    it.each(SAMPLES.map(file => path.relative(ENGINE, file)))("%s is in the current shape: no migration changes it", file => {
        const config = read(path.join(ENGINE, file));
        expect(migrated(config)).toEqual(config);
    });
});
