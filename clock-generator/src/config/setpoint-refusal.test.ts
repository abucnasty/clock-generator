import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { ConfigValidationError } from "./errors";
import { refusalOfPick, refusalOfPickIn } from "./setpoint-refusal";
import { setpointOutputOf } from "../data/setpoint-output";

const build = (setpoint: { item?: string; recipe?: string; counts?: string }, ...recipes: string[]) => ({
    setpoint: { items_per_second: 1, copies: 1, ...setpoint },
    machines: recipes.map((recipe, index) => ({ id: index + 1, recipe, productivity: 0, crafting_speed: 1 })),
    inserters: [],
    belts: [],
});
const parse = (config: unknown) => ConfigSchema.safeParse(config);
/** The reasons of the issues a parse found, with the path of each */
const reasonsOf = (config: unknown) => {
    const result = parse(config);
    return result.success ? [] : result.error.issues.map(issue => ({ path: issue.path.join("."), reason: (issue as { params?: { reason?: unknown } }).params?.reason }));
};
const itemOf = (config: unknown) => { const result = parse(config); return result.success ? result.data.setpoint.item : undefined; };

describe("the refusal of a pick the engine does not count yet", () => {
    it("is the code and the choice for the item that a recipe with several outputs does not count", () => {
        expect(refusalOfPick("jellynut-seed", ["jellynut-processing"])).toEqual({ code: "not-counted-yet", item: "jellynut-seed", choice: "jelly" });
        expect(refusalOfPick("copper-ore", ["advanced-metallic-asteroid-crushing"])).toEqual({ code: "not-counted-yet", item: "copper-ore", choice: "iron-ore" });
        expect(refusalOfPick("uranium-235", ["uranium-processing"])).toEqual({ code: "not-counted-yet", item: "uranium-235", choice: "uranium-238" });
    });

    it("is null for the output the engine counts, an item the recipe does not make, and an item another recipe of the build makes", () => {
        expect(refusalOfPick("jelly", ["jellynut-processing"])).toBeNull();
        expect(refusalOfPick("iron-plate", ["jellynut-processing"])).toBeNull();
        expect(refusalOfPick("jellynut-seed", ["jellynut-processing", "jellynut-seed-recycling"])).toBeNull();
        expect(refusalOfPick("jellynut-seed", [])).toBeNull();
    });

    it("takes the recipe of the build in its order: the first one that has the item as a choice it does not count", () => {
        expect(refusalOfPick("copper-ore", ["iron-gear-wheel", "advanced-metallic-asteroid-crushing"])).toMatchObject({ choice: "iron-ore" });
        expect(refusalOfPick("copper-ore", ["advanced-metallic-asteroid-crushing", "copper-ore-recycling"])).toBeNull();
    });

    it("refuses the bacterium and not spoilage on a build of a bacteria recipe (the engine counts spoilage)", () => {
        expect(refusalOfPick("iron-bacteria", ["iron-bacteria"])).toBeNull();
        expect(refusalOfPick("spoilage", ["iron-bacteria"])).toBeNull();
        expect(refusalOfPick("iron-bacteria", ["iron-bacteria", "iron-bacteria-cultivation"])).toBeNull();
        expect(refusalOfPick("copper-bacteria", ["copper-bacteria"])).toBeNull();
    });

    it("refuses the bacterium picked within the bacteria recipe alone, a choice that is not preselected", () => {
        // `refusalOfPick` reads the recipe's choices: the bacterium is a choice, spoilage the preselected one
        const output = setpointOutputOf("iron-bacteria");
        expect(refusalOfPickIn("iron-bacteria", ["iron-bacteria"], () => output)).toBeNull();
        expect(output).toMatchObject({ item: "spoilage" });
        // a pick that is a choice, not the preselected one and made by no recipe of the list
        expect(refusalOfPickIn("iron-bacteria", ["x"], () => ({ kind: "output", item: "spoilage", choices: ["iron-bacteria", "spoilage"] })))
            .toEqual({ code: "not-counted-yet", item: "iron-bacteria", choice: "spoilage" });
    });

    it("has no refusal for the reprocessings and kovarex, which have no choice to refuse", () => {
        expect(refusalOfPick("carbonic-asteroid-chunk", ["metallic-asteroid-reprocessing"])).toBeNull();
        expect(refusalOfPick("uranium-238", ["kovarex-enrichment-process"])).toBeNull();
    });

    it("works for the smaller result of a recycling recipe", () => {
        const output = setpointOutputOf("atomic-bomb-recycling");
        if (output?.kind !== "output") throw new Error("a recycling recipe has an output");
        expect(output.choices.length).toBeGreaterThan(1);
        const smaller = output.choices.find(item => item !== output.item)!;
        expect(smaller).toBeDefined();
        expect(refusalOfPick(smaller, ["atomic-bomb-recycling"])).toEqual({ code: "not-counted-yet", item: smaller, choice: output.item });
    });
});

describe("a config whose setpoint names an output the engine does not count yet", () => {
    it("is refused at `setpoint.item`, with the code and the data, in the issue's `params.reason`", () => {
        expect(reasonsOf(build({ item: "jellynut-seed" }, "jellynut-processing")))
            .toEqual([{ path: "setpoint.item", reason: { code: "not-counted-yet", item: "jellynut-seed", choice: "jelly" } }]);
        expect(reasonsOf(build({ item: "copper-ore" }, "advanced-metallic-asteroid-crushing"))[0].reason).toEqual({ code: "not-counted-yet", item: "copper-ore", choice: "iron-ore" });
        expect(reasonsOf(build({ item: "uranium-235" }, "uranium-processing"))[0].reason).toMatchObject({ item: "uranium-235", choice: "uranium-238" });
    });

    it("carries the technical string in the issue's message, no sentence for a user", () => {
        const result = parse(build({ item: "jellynut-seed" }, "jellynut-processing"));
        expect(result.error?.issues[0].message).toBe("not-counted-yet: item=jellynut-seed choice=jelly");
        const error = new ConfigValidationError(result.error!);
        expect(error.message).toContain("not-counted-yet: item=jellynut-seed choice=jelly");
    });

    it("carries the reason in the issue of a ConfigValidationError", () => {
        const input = build({ item: "jellynut-seed" }, "jellynut-processing");
        const error = new ConfigValidationError(parse(input).error!, input);
        expect(error.issues).toEqual([expect.objectContaining({ path: "setpoint.item", reason: { code: "not-counted-yet", item: "jellynut-seed", choice: "jelly" } })]);
    });

    it("loads where the engine counts the item, where another machine of the build makes it, and where the setpoint counts an item destroyed", () => {
        expect(itemOf(build({ item: "jelly" }, "jellynut-processing"))).toBe("jelly");
        expect(itemOf(build({ item: "jellynut-seed" }, "jellynut-processing", "jellynut-seed-recycling"))).toBe("jellynut-seed");
        expect(itemOf(build({ item: "jellynut-seed", counts: "destroyed" }, "jellynut-processing"))).toBe("jellynut-seed");
    });

    it("is refused for `recipe: jellynut-seed`, an item in the old field, as `item` is", () => {
        expect(reasonsOf(build({ recipe: "jellynut-seed" }, "jellynut-processing")))
            .toEqual([{ path: "setpoint.item", reason: { code: "not-counted-yet", item: "jellynut-seed", choice: "jelly" } }]);
    });

    it("loads the name of a recipe as the item it counts: the recipe's name is read, not refused", () => {
        expect(itemOf(build({ item: "jellynut-processing" }, "jellynut-processing"))).toBe("jelly");
    });
});

describe("a config whose setpoint names a recipe with no item result", () => {
    it("is refused with `no-countable-output` and the recipe, unless a machine of the build makes that name", () => {
        expect(reasonsOf(build({ item: "sulfuric-acid" }, "sulfuric-acid")))
            .toEqual([{ path: "setpoint.item", reason: { code: "no-countable-output", recipe: "sulfuric-acid" } }]);
        const result = parse(build({ item: "sulfuric-acid" }, "iron-gear-wheel"));
        expect(result.error?.issues[0].message).toBe("no-countable-output: recipe=sulfuric-acid");
    });

    it("loads with `counts: destroyed`", () => {
        expect(itemOf(build({ item: "sulfuric-acid", counts: "destroyed" }, "iron-gear-wheel"))).toBe("sulfuric-acid");
    });

    it("leaves a name that is no recipe and no item to the other checks, as before", () => {
        expect(itemOf(build({ item: "no-such-thing" }, "iron-gear-wheel"))).toBe("no-such-thing");
    });
});

describe("a config whose machines make an output with nothing to choose (counted as today)", () => {
    it("loads the own chunk of a reprocessing and finds a machine; another chunk loads and finds none, as before", () => {
        expect(itemOf(build({ item: "metallic-asteroid-chunk" }, "metallic-asteroid-reprocessing"))).toBe("metallic-asteroid-chunk");
        expect(itemOf(build({ item: "carbonic-asteroid-chunk" }, "metallic-asteroid-reprocessing"))).toBe("carbonic-asteroid-chunk");
    });

    it("reads the name of a reprocessing or the kovarex process as the item the engine counts, where a machine makes it", () => {
        expect(itemOf(build({ item: "metallic-asteroid-reprocessing" }, "metallic-asteroid-reprocessing"))).toBe("metallic-asteroid-chunk");
        expect(itemOf(build({ item: "kovarex-enrichment-process" }, "kovarex-enrichment-process"))).toBe("uranium-235");
    });
});

describe("the two bacteria recipes (the engine counts spoilage)", () => {
    it("load `spoilage` as today, and read the recipe's name as spoilage", () => {
        expect(itemOf(build({ item: "spoilage" }, "iron-bacteria"))).toBe("spoilage");
        expect(itemOf(build({ item: "iron-bacteria" }, "iron-bacteria"))).toBe("spoilage");
        expect(itemOf(build({ item: "copper-bacteria" }, "copper-bacteria"))).toBe("spoilage");
    });

    it("keep the bacterium where a build of the cultivation recipe makes it", () => {
        expect(itemOf(build({ item: "iron-bacteria" }, "iron-bacteria", "iron-bacteria-cultivation"))).toBe("iron-bacteria");
        expect(itemOf(build({ item: "iron-bacteria" }, "iron-bacteria-cultivation"))).toBe("iron-bacteria");
    });
});
