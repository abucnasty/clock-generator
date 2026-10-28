import { describe, test, expect } from "vitest"
import { RecipeMetadata, amountIgnoredByProductivity, expectedAmount } from "./recipe-metadata"
import { Ingredient } from "../../../data/factorio-data-types"

describe("Recipe Metadata", () => {

    const filterToOnlyIngredientProps = (ingredient: Ingredient) => {
        return {
            type: ingredient.type,
            name: ingredient.name,
            amount: ingredient.amount
        }
    }

    test("creates recipe metadata from recipe name", () => {
        const recipeMetadata = RecipeMetadata.fromRecipeName("iron-gear-wheel")
        expect(recipeMetadata.name).toBe("iron-gear-wheel")
    })

    test("throws an error for unknown recipe", () => {
        expect(() => RecipeMetadata.fromRecipeName("unknown-recipe")).toThrowError("Recipe unknown-recipe was not found")
    })

    test("retrieves ingredients correctly", () => {
        const recipeMetadata = RecipeMetadata.fromRecipeName("iron-gear-wheel")
        const ingredients: Ingredient[] = Array.from(recipeMetadata.inputsPerCraft.values()).map(input => input)
        
        expect(ingredients.map(filterToOnlyIngredientProps)).toEqual([
            { type: "item", name: "iron-plate", amount: 2 }
        ])
    })

    test("filters out fluid ingredients", () => {
        const recipeMetadata = RecipeMetadata.fromRecipeName("plastic-bar")
        const ingredients: Ingredient[] = Array.from(recipeMetadata.inputsPerCraft.values()).map(input => input)
        expect(ingredients.map(filterToOnlyIngredientProps)).toEqual([
            { type: "item", name: "coal", amount: 1 }
        ])
        expect(ingredients.map(it => it.name)).not.toContain("petroleum-gas")
    })

    test("uses default energy required if not specified", () => {
        const recipeMetadata = RecipeMetadata.fromRecipeName("iron-gear-wheel")
        expect(recipeMetadata.energy_required).toBe(0.5)
    })

    describe("amount ignored by productivity", () => {
        const result = (extras: object): Ingredient => ({ type: "item", name: "test-item", amount: 1, ...extras } as Ingredient)

        test("is 0 for a result that sets neither field", () => {
            expect(amountIgnoredByProductivity(result({}))).toBe(0)
        })

        test("defaults to ignored_by_stats when ignored_by_productivity is missing", () => {
            expect(amountIgnoredByProductivity(result({ amount: 3, ignored_by_stats: 2 }))).toBe(2)
        })

        test("an ignored_by_productivity that is set wins over ignored_by_stats", () => {
            expect(amountIgnoredByProductivity(result({ amount: 3, ignored_by_stats: 2, ignored_by_productivity: 1 }))).toBe(1)
            expect(amountIgnoredByProductivity(result({ amount: 3, ignored_by_stats: 2, ignored_by_productivity: 0 }))).toBe(0)
        })

        test("never exceeds what a craft yields on average", () => {
            const chunk = result({ independent_probability: 0.3, ignored_by_stats: 1 })
            expect(amountIgnoredByProductivity(chunk)).toBeCloseTo(expectedAmount(chunk))
            expect(amountIgnoredByProductivity(chunk)).toBeCloseTo(0.3)
        })

        test("a result the recipe data gives only ignored_by_stats is not multiplied by productivity", () => {
            const chunk = RecipeMetadata.fromRecipeName("metallic-asteroid-crushing").outputs
                .find(it => it.name === "metallic-asteroid-chunk")
            expect(chunk).toBeDefined()
            expect(chunk).toMatchObject({ ignored_by_stats: 1 })
            expect(chunk).not.toHaveProperty("ignored_by_productivity")
            expect(amountIgnoredByProductivity(chunk!)).toBeCloseTo(expectedAmount(chunk!))
        })
    })
})
