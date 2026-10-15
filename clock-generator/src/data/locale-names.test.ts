import { describe, it, expect } from "vitest";

interface LocaleNames {
    parseLocale(cfgText: string): Record<string, string>;
    evaluateLocalised(localised: unknown, table: Record<string, string>): string | null;
    buildNames(
        raw: Record<string, Record<string, unknown>>,
        filtered: Record<string, Record<string, unknown>>,
        table: Record<string, string>,
    ): {
        names: { item: Record<string, string>; recipe: Record<string, string> };
        fallbackIds: string[];
        fallbackCount: { item: number; recipe: number };
    };
}

// resources/ is plain CommonJS outside src, which the data dump (filter-raw.js) runs with node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLocale, evaluateLocalised, buildNames }: LocaleNames = require("../../resources/locale-names.js");

describe("parseLocale", () => {
    it("keys each value by its section, splitting at the first =", () => {
        const table = parseLocale([
            "root-key=skipped, before any section",
            "[item-name]",
            "iron-plate=Iron plate",
            "; a comment",
            "# another comment",
            "",
            "equation=a=b",
            "[fluid-name]",
            "water=Water",
        ].join("\n"));
        expect(table).toEqual({
            "item-name.iron-plate": "Iron plate",
            "item-name.equation": "a=b",
            "fluid-name.water": "Water",
        });
    });

    it("reads Windows line endings", () => {
        expect(parseLocale("[item-name]\r\nstone=Stone\r\ncoal=Coal\r\n")).toEqual({
            "item-name.stone": "Stone",
            "item-name.coal": "Coal",
        });
    });
});

describe("evaluateLocalised", () => {
    const table = {
        "item-name.iron-plate": "Iron plate",
        "item-name.filled-barrel": "__1__ barrel",
        "fluid-name.water": "Water",
        "recipe-name.uses-item": "Make __ITEM__iron-plate__ from __FLUID__water__ and __ITEM__no-such-item__",
    };

    it("gives a plain string as it is", () => {
        expect(evaluateLocalised("Just text", table)).toBe("Just text");
    });

    it("looks a key up", () => {
        expect(evaluateLocalised(["item-name.iron-plate"], table)).toBe("Iron plate");
    });

    it("fills the parameters", () => {
        expect(evaluateLocalised(["item-name.filled-barrel", ["fluid-name.water"]], table)).toBe("Water barrel");
    });

    it("joins the parameters of the empty key", () => {
        expect(evaluateLocalised(["", "A", "B"], table)).toBe("AB");
    });

    it("expands the item and fluid macros, to the id when it has no name", () => {
        expect(evaluateLocalised(["recipe-name.uses-item"], table)).toBe("Make Iron plate from Water and no-such-item");
    });

    it("returns null for a missing key, or a missing parameter, without throwing", () => {
        expect(evaluateLocalised(["item-name.missing"], table)).toBeNull();
        expect(evaluateLocalised(["item-name.filled-barrel", ["fluid-name.missing"]], table)).toBeNull();
        expect(evaluateLocalised(["item-name.filled-barrel"], table)).toBeNull();
        expect(evaluateLocalised(["constructor"], table)).toBeNull();
    });

    it("returns null when the text keeps a __…__ it does not evaluate", () => {
        const plural = { "item-name.ores": "__1__ __plural_for_parameter__1__{1=ore|rest=ores}__", "item-name.tile": "__TILE__stone-path__" };
        expect(evaluateLocalised(["item-name.ores", "2"], plural)).toBeNull();
        expect(evaluateLocalised(["item-name.tile"], plural)).toBeNull();
    });
});

describe("buildNames", () => {
    const table = {
        "item-name.iron-plate": "Iron plate",
        "item-name.filled-barrel": "__1__ barrel",
        "item-name.uranium-235": "Uranium-235",
        "item-name.capture-robot-rocket": "Capture bot rocket",
        "fluid-name.water": "Water",
        "fluid-name.light-oil": "Light oil",
        "entity-name.burner-mining-drill": "Burner mining drill",
        "recipe-name.fill-barrel": "Fill __1__ barrel",
        "recipe-name.recycling": "__1__ recycling",
        "recipe-name.basic-oil-processing": "Basic oil processing",
    };
    const recipes = {
        // named by its own localised_name
        "water-barrel": {
            name: "water-barrel",
            localised_name: ["recipe-name.fill-barrel", ["fluid-name.water"]],
            ingredients: [{ type: "fluid", name: "water", amount: 50 }],
            results: [{ type: "item", name: "water-barrel", amount: 1 }],
        },
        // named by recipe-name
        "basic-oil-processing": {
            name: "basic-oil-processing",
            ingredients: [],
            results: [{ type: "fluid", name: "light-oil", amount: 45 }, { type: "item", name: "iron-plate", amount: 1 }],
        },
        // named by its only result
        "uranium-235": {
            name: "uranium-235",
            ingredients: {},
            results: [{ type: "item", name: "uranium-235", amount: 1 }],
        },
        // named by its main product, a fluid
        "oil-cracking": {
            name: "oil-cracking",
            main_product: "light-oil",
            ingredients: [{ type: "fluid", name: "water", amount: 10 }],
            results: [{ type: "fluid", name: "light-oil", amount: 5 }, { type: "item", name: "iron-plate", amount: 1 }],
        },
        // a recycling recipe
        "iron-plate-recycling": {
            name: "iron-plate-recycling",
            localised_name: ["recipe-name.recycling", ["item-name.iron-plate"]],
            ingredients: [{ type: "item", name: "iron-plate", amount: 1 }],
            results: [{ type: "item", name: "iron-plate", amount: 1 }],
        },
        // a mod recipe with no text: neither its own nor its products'
        "ee-infinity-chest": {
            name: "ee-infinity-chest",
            ingredients: [],
            results: [{ type: "item", name: "ee-infinity-chest", amount: 1 }, { type: "item", name: "capture-robot-rocket", amount: 1 }],
        },
    };
    const raw = {
        recipe: recipes,
        item: {
            "iron-plate": { name: "iron-plate" },
            "water-barrel": { name: "water-barrel", localised_name: ["item-name.filled-barrel", ["fluid-name.water"]] },
            "uranium-235": { name: "uranium-235" },
            "ee-infinity-chest": { name: "ee-infinity-chest" },
        },
        ammo: { "capture-robot-rocket": { name: "capture-robot-rocket" } },
        fluid: { water: { name: "water" }, "light-oil": { name: "light-oil" } },
        "mining-drill": { "burner-mining-drill": { name: "burner-mining-drill" } },
    };
    const filtered = {
        recipe: recipes,
        "mining-drill": raw["mining-drill"],
        resource: {},
        item: {
            "iron-plate": { name: "iron-plate" },
            "water-barrel": { name: "water-barrel" },
            "uranium-235": { name: "uranium-235" },
            "ee-infinity-chest": { name: "ee-infinity-chest" },
            "capture-robot-rocket": { name: "capture-robot-rocket" },
        },
    };
    const { names, fallbackIds, fallbackCount } = buildNames(raw, filtered, table);

    it("names an item by its own localised_name", () => {
        expect(names.item["water-barrel"]).toBe("Water barrel");
    });

    it("names an item by its item, fluid or entity name", () => {
        expect(names.item["iron-plate"]).toBe("Iron plate");
        expect(names.item["water"]).toBe("Water");
        expect(names.item["burner-mining-drill"]).toBe("Burner mining drill");
    });

    it("takes the locale names that a rule on the id would get wrong", () => {
        expect(names.item["uranium-235"]).toBe("Uranium-235");
        expect(names.item["capture-robot-rocket"]).toBe("Capture bot rocket");
    });

    it("names a recipe by its own localised_name, apart from the item of the same id", () => {
        expect(names.recipe["water-barrel"]).toBe("Fill Water barrel");
        expect(names.item["water-barrel"]).toBe("Water barrel");
    });

    it("names a recipe by recipe-name", () => {
        expect(names.recipe["basic-oil-processing"]).toBe("Basic oil processing");
    });

    it("names a recipe by its only result", () => {
        expect(names.recipe["uranium-235"]).toBe("Uranium-235");
    });

    it("names a recipe by its main product, a fluid", () => {
        expect(names.recipe["oil-cracking"]).toBe("Light oil");
    });

    it("names a recycling recipe", () => {
        expect(names.recipe["iron-plate-recycling"]).toBe("Iron plate recycling");
    });

    it("gives an id with no text a sentence-case name and lists it", () => {
        expect(names.item["ee-infinity-chest"]).toBe("Ee infinity chest");
        expect(names.recipe["ee-infinity-chest"]).toBe("Ee infinity chest");
        expect(fallbackIds).toEqual(["ee-infinity-chest"]);
        expect(fallbackCount).toEqual({ item: 1, recipe: 1 });
    });

    it("names every item, ingredient and result, and writes the ids in order", () => {
        expect(Object.keys(names.item)).toEqual([
            "burner-mining-drill", "capture-robot-rocket", "ee-infinity-chest", "iron-plate", "light-oil", "uranium-235", "water", "water-barrel",
        ]);
        expect(Object.keys(names.recipe)).toEqual([...Object.keys(recipes)].sort());
    });
});
