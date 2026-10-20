import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";
import { ConfigSchema, InserterConfigSchema } from "./schema";
import { Config } from "./index";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { validateConfig } from "../crafting/plan/validate-config";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { computeMachineTargetRates } from "../crafting/machine-target-rates";

const base = () => ({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16 },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16 },
    ],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }] }],
    chests: [{ id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true }],
});
const withSource = (fields: object) => {
    const config = base();
    return { ...config, inserters: [{ ...config.inserters[0], source: { ...config.inserters[0].source, ...fields } }, config.inserters[1]] };
};
const merge = { lane: 1, outer: { ingredient: "iron-plate", stack_size: 4 }, inner: { ingredient: "iron-plate", stack_size: 4 }, downstream_tiles: 3, outlet: "open" };

describe("a pickup from a side-loaded belt tile", () => {
    it.each([
        { field: "pickup_supply", value: ["side-inner"] },
        { field: "pickup_supply", value: ["side-outer"] },
        // never released, so even a profile that names no side feed is refused rather than read
        { field: "pickup_supply", value: ["through"] },
        { field: "pickup_merge", value: merge },
    ])("is refused by the schema with the reason when it names $field $value", async ({ field, value }) => {
        await expect(parseConfig(JSON.stringify(withSource({ [field]: value })))).rejects.toThrow(
            `Configuration validation failed at 'inserters[0].source.${field}': \`${field}\` is refused: picking up from a belt tile that another belt side-loads onto`);
    });

    it("is never stripped and read as a belt running straight onto the pickup tile", () => {
        expect(ConfigSchema.safeParse(withSource({ pickup_supply: ["side-inner"] })).success).toBe(false);
        expect(InserterConfigSchema.safeParse(withSource({ pickup_merge: merge }).inserters[0]).success).toBe(false);
    });

    it.each(["pickup_supply", "pickup_merge"])("is refused by the engine when a config naming %s did not pass the schema", field => {
        const config = ConfigSchema.parse(base());
        const source = config.inserters[0].source as unknown as Record<string, unknown>;
        source[field] = field === "pickup_supply" ? ["side-inner"] : merge;
        expect(() => SimulationContext.fromConfig(config as Config)).toThrow(`Inserter 1: \`${field}\` is refused: picking up from a belt tile`);
    });

    it("leaves a belt running straight onto the pickup tile as it was", () => {
        const config = ConfigSchema.parse(base());
        expect(config.inserters[0].source).toEqual({ type: "belt", id: 1, pickup_length: 1 });
        expect(() => SimulationContext.fromConfig(config)).not.toThrow();
    });
});

describe("an out-of-scope pickup whose side stream brings an ingredient", () => {
    // without the side stream the belt lacks copper cable: the refusal has to come before the coverage check asks for it
    const circuits = () => ({
        target_output: { recipe: "electronic-circuit", items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: "electronic-circuit", crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16 },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16 },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] }],
        chests: [{ id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true }],
    });
    const mixedMerge = { lane: 2, outer: { ingredient: "iron-plate", stack_size: 4 }, inner: { ingredient: "copper-cable", stack_size: 4 }, downstream_tiles: 3, outlet: "open" };
    const quiet = { log() {}, warn() {}, error() {}, debug() {} };

    it("is refused as out of scope, not as a missing inserter, when the config names the merge", () => {
        const config = circuits() as unknown as Config;
        (config.inserters[0].source as unknown as Record<string, unknown>).pickup_merge = mixedMerge;
        expect(() => validateConfig(config)).toThrow("Inserter 1: `pickup_merge` is refused: picking up from a belt tile");
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow("Inserter 1: `pickup_merge` is refused");
        expect(() => computeMachineTargetRates(config)).toThrow("Inserter 1: `pickup_merge` is refused");
    });

    it("is refused as out of scope, not as a missing inserter, when it was captured as side-loaded", () => {
        const config = ConfigSchema.parse({ ...circuits(), sidecar_version: "0.11.0", pickup_warnings: [{ inserter_id: 1, reason: "side-loaded" }] });
        expect(() => validateConfig(config)).toThrow(/Inserter 1: Pickup captured as unsupported \(side-loaded\): picking up from a belt tile/);
    });
});

describe("a Sidecar capture of an out-of-scope pickup", () => {
    it.each([
        { reason: "side-loaded", says: /Inserter 1: Pickup captured as unsupported \(side-loaded\): picking up from a belt tile that another belt side-loads onto/ },
        { reason: "splitter", says: /Inserter 1: Pickup captured as unsupported \(splitter\): picking up from a splitter is out of scope\.$/ },
    ])("stays refused across save and reload as out of scope ($reason)", ({ reason, says }) => {
        let config = ConfigSchema.parse({ ...base(), sidecar_version: "0.11.0", pickup_warnings: [{ inserter_id: 1, reason }] });
        for (let reload = 0; reload < 3; reload++) {
            config = ConfigSchema.parse(JSON.parse(JSON.stringify(config)));
            expect(config.inserters[0].source).toMatchObject({ pickup_capture: { status: "unsupported", reason } });
            expect(() => SimulationContext.fromConfig(config)).toThrow(says);
        }
    });

    it("does not promise support after an update of the mod for what is out of scope", () => {
        const config = ConfigSchema.parse({ ...base(), sidecar_version: "0.11.0", pickup_warnings: [{ inserter_id: 1, reason: "side-loaded" }] });
        expect(() => SimulationContext.fromConfig(config)).not.toThrow(/new Sidecar capture/);
        expect(() => SimulationContext.fromConfig(config)).toThrow(/out of scope/);
    });
});
