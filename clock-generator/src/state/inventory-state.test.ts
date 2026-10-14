import { describe, test, expect } from "vitest"
import { InventoryState } from "./inventory-state"
import { MachineInput } from "../entities"

describe("InventoryState", () => {
    describe("creation and initialization", () => {
        test("empty() creates an empty inventory", () => {
            const inventory = InventoryState.empty()
            expect(inventory.isEmpty()).toBe(true)
            expect(inventory.getTotalQuantity()).toBe(0)
            expect(inventory.getItems()).toEqual([])
        })

        test("empty inventory has zero quantity for any item", () => {
            const inventory = InventoryState.empty()
            expect(inventory.getQuantity("stone")).toBe(0)
            expect(inventory.getQuantity("iron-ore")).toBe(0)
        })

        test("createEmptyForSingleItem initializes a single item to 0", () => {
            const inventory = InventoryState.createEmptyForSingleItem("stone")
            expect(inventory.getQuantity("stone")).toBe(0)
            expect(inventory.getItem("stone")).toEqual({
                item_name: "stone",
                quantity: 0
            })
        })

        test("createFromMachineInputs initializes all input items to 0", () => {
            const inputs = new Map<string, MachineInput>([
                ["stone", { item_name: "stone", consumption_rate: null, automated_insertion_limit: null, ingredient: null } as any],
                ["iron-ore", { item_name: "iron-ore", consumption_rate: null, automated_insertion_limit: null, ingredient: null } as any],
            ])

            const inventory = InventoryState.createFromMachineInputs(inputs)
            expect(inventory.getQuantity("stone")).toBe(0)
            expect(inventory.getQuantity("iron-ore")).toBe(0)
        })

        test("constructor accepts initial inventory map", () => {
            const initialInventory = { "stone": 100, "iron-ore": 50 }
            const inventory = new InventoryState(initialInventory)
            expect(inventory.getQuantity("stone")).toBe(100)
            expect(inventory.getQuantity("iron-ore")).toBe(50)
        })
    })

    describe("adding quantities", () => {
        test("addQuantity adds to existing quantity", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            expect(inventory.getQuantity("stone")).toBe(100)
        })

        test("addQuantity creates item if it doesn't exist", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 50)
            expect(inventory.getQuantity("stone")).toBe(50)
            expect(inventory.getItem("stone")).not.toBeNull()
        })

        test("addQuantity multiple times accumulates correctly", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("stone", 50)
            inventory.addQuantity("stone", 25)
            expect(inventory.getQuantity("stone")).toBe(175)
        })

        test("addQuantity with zero amount works correctly", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 0)
            expect(inventory.getQuantity("stone")).toBe(0)
        })

        test("addQuantity rejects negative amounts", () => {
            const inventory = InventoryState.empty()
            expect(() => inventory.addQuantity("stone", -10)).toThrow("Cannot add negative amount")
        })
    })

    describe("removing quantities", () => {
        test("removeQuantity removes from inventory", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.removeQuantity("stone", 30)
            expect(inventory.getQuantity("stone")).toBe(70)
        })

        test("removeQuantity to zero leaves item in inventory", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 50)
            inventory.removeQuantity("stone", 50)
            expect(inventory.getQuantity("stone")).toBe(0)
            expect(inventory.getItem("stone")).toEqual({
                item_name: "stone",
                quantity: 0
            })
        })

        test("removeQuantity throws when insufficient quantity", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 30)
            expect(() => inventory.removeQuantity("stone", 50))
                .toThrow("Insufficient inventory: have 30, need 50 of stone")
        })

        test("removeQuantity throws with negative amount", () => {
            const inventory = InventoryState.empty()
            expect(() => inventory.removeQuantity("stone", -10)).toThrow("Cannot remove negative amount")
        })

        test("removeQuantity from non-existent item throws", () => {
            const inventory = InventoryState.empty()
            expect(() => inventory.removeQuantity("stone", 10))
                .toThrow("Insufficient inventory: have 0, need 10 of stone")
        })
    })

    describe("setting quantities", () => {
        test("setQuantity creates item with specified amount", () => {
            const inventory = InventoryState.empty()
            inventory.setQuantity("stone", 100)
            expect(inventory.getQuantity("stone")).toBe(100)
        })

        test("setQuantity overwrites existing quantity", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 50)
            inventory.setQuantity("stone", 150)
            expect(inventory.getQuantity("stone")).toBe(150)
        })

        test("setQuantity to zero works", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 50)
            inventory.setQuantity("stone", 0)
            expect(inventory.getQuantity("stone")).toBe(0)
        })

        test("setQuantity rejects negative amounts", () => {
            const inventory = InventoryState.empty()
            expect(() => inventory.setQuantity("stone", -10)).toThrow("Cannot set negative amount")
        })
    })

    describe("querying inventory", () => {
        test("getItem returns item with quantity", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            const item = inventory.getItem("stone")
            expect(item).toEqual({ item_name: "stone", quantity: 100 })
        })

        test("getItem returns null for non-existent item", () => {
            const inventory = InventoryState.empty()
            const item = inventory.getItem("stone")
            expect(item).toBeNull()
        })

        test("getItemOrThrow returns item for existing item", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            const item = inventory.getItemOrThrow("stone")
            expect(item).toEqual({ item_name: "stone", quantity: 100 })
        })

        test("getItemOrThrow throws for non-existent item", () => {
            const inventory = InventoryState.empty()
            expect(() => inventory.getItemOrThrow("stone")).toThrow("Item not found in inventory: stone")
        })

        test("hasQuantity returns true when item has enough", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            expect(inventory.hasQuantity("stone", 50)).toBe(true)
            expect(inventory.hasQuantity("stone", 100)).toBe(true)
        })

        test("hasQuantity returns false when item doesn't have enough", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            expect(inventory.hasQuantity("stone", 101)).toBe(false)
        })

        test("hasQuantity returns false for non-existent item", () => {
            const inventory = InventoryState.empty()
            expect(inventory.hasQuantity("stone", 1)).toBe(false)
        })
    })

    describe("getItems and getAllItems", () => {
        test("getItems returns only items with quantity > 0", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 0)
            inventory.addQuantity("coal", 50)

            const items = inventory.getItems()
            expect(items).toHaveLength(2)
            expect(items).toContainEqual({ item_name: "stone", quantity: 100 })
            expect(items).toContainEqual({ item_name: "coal", quantity: 50 })
        })

        test("getAllItems returns all items including zero quantities", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 0)
            inventory.addQuantity("coal", 50)

            const items = inventory.getAllItems()
            expect(items).toHaveLength(3)
            expect(items).toContainEqual({ item_name: "stone", quantity: 100 })
            expect(items).toContainEqual({ item_name: "iron-ore", quantity: 0 })
            expect(items).toContainEqual({ item_name: "coal", quantity: 50 })
        })

        test("getItems returns empty array when all items are zero", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 0)
            inventory.addQuantity("iron-ore", 0)

            const items = inventory.getItems()
            expect(items).toHaveLength(0)
        })
    })

    describe("total quantity", () => {
        test("getTotalQuantity sums all quantities", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 50)
            inventory.addQuantity("coal", 25)
            expect(inventory.getTotalQuantity()).toBe(175)
        })

        test("getTotalQuantity is zero for empty inventory", () => {
            const inventory = InventoryState.empty()
            expect(inventory.getTotalQuantity()).toBe(0)
        })

        test("getTotalQuantity ignores zero quantities", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 0)
            inventory.addQuantity("coal", 50)
            expect(inventory.getTotalQuantity()).toBe(150)
        })
    })

    describe("isEmpty", () => {
        test("isEmpty returns true for empty inventory", () => {
            const inventory = InventoryState.empty()
            expect(inventory.isEmpty()).toBe(true)
        })

        test("isEmpty returns false when inventory has items", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 1)
            expect(inventory.isEmpty()).toBe(false)
        })

        test("isEmpty returns true after removing all items", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.removeQuantity("stone", 100)
            expect(inventory.isEmpty()).toBe(true)
        })

        test("isEmpty returns true when all quantities are zero", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 0)
            inventory.addQuantity("iron-ore", 0)
            expect(inventory.isEmpty()).toBe(true)
        })
    })

    describe("clear", () => {
        test("clear removes all items from inventory", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 50)
            inventory.clear()
            expect(inventory.isEmpty()).toBe(true)
            expect(inventory.getTotalQuantity()).toBe(0)
        })

        test("clear removes items so they return null on getItem", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.clear()
            expect(inventory.getItem("stone")).toBeNull()
        })
    })

    describe("resetItem", () => {
        test("resetItem removes specific item from inventory", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 50)
            inventory.resetItem("stone")
            expect(inventory.getItem("stone")).toBeNull()
            expect(inventory.getQuantity("stone")).toBe(0)
            expect(inventory.getQuantity("iron-ore")).toBe(50)
        })

        test("resetItem returns zero quantity for reset item", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.resetItem("stone")
            expect(inventory.getQuantity("stone")).toBe(0)
        })

        test("resetItem on non-existent item is safe", () => {
            const inventory = InventoryState.empty()
            expect(() => inventory.resetItem("stone")).not.toThrow()
        })
    })

    describe("clone", () => {
        test("clone creates independent copy", () => {
            const original = InventoryState.empty()
            original.addQuantity("stone", 100)
            original.addQuantity("iron-ore", 50)

            const cloned = original.clone()

            expect(cloned.getQuantity("stone")).toBe(100)
            expect(cloned.getQuantity("iron-ore")).toBe(50)
        })

        test("modifications to clone don't affect original", () => {
            const original = InventoryState.empty()
            original.addQuantity("stone", 100)

            const cloned = original.clone()
            cloned.addQuantity("stone", 50)

            expect(original.getQuantity("stone")).toBe(100)
            expect(cloned.getQuantity("stone")).toBe(150)
        })

        test("modifications to original don't affect clone", () => {
            const original = InventoryState.empty()
            original.addQuantity("stone", 100)

            const cloned = original.clone()
            original.addQuantity("stone", 50)

            expect(original.getQuantity("stone")).toBe(150)
            expect(cloned.getQuantity("stone")).toBe(100)
        })

        test("clone preserves all items and quantities", () => {
            const original = InventoryState.empty()
            original.addQuantity("stone", 100)
            original.addQuantity("iron-ore", 50)
            original.addQuantity("coal", 25)
            original.addQuantity("copper-ore", 0)

            const cloned = original.clone()

            expect(cloned.getAllItems()).toEqual(original.getAllItems())
        })
    })

    describe("export", () => {
        test("export returns record of all items", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 50)
            inventory.addQuantity("coal", 25)

            const exported = inventory.export()
            expect(exported).toEqual({
                "stone": 100,
                "iron-ore": 50,
                "coal": 25
            })
        })

        test("export includes zero quantities", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 0)

            const exported = inventory.export()
            expect(exported).toEqual({
                "stone": 100,
                "iron-ore": 0
            })
        })

        test("exported data can be used to create new inventory", () => {
            const original = InventoryState.empty()
            original.addQuantity("stone", 100)
            original.addQuantity("iron-ore", 50)

            const exported = original.export()
            const recreated = new InventoryState(exported)

            expect(recreated.getQuantity("stone")).toBe(100)
            expect(recreated.getQuantity("iron-ore")).toBe(50)
        })
    })

    describe("edge cases and stress tests", () => {
        test("handles large quantities", () => {
            const inventory = InventoryState.empty()
            const largeAmount = 1_000_000_000
            inventory.addQuantity("stone", largeAmount)
            expect(inventory.getQuantity("stone")).toBe(largeAmount)
        })

        test("handles many different items", () => {
            const inventory = InventoryState.empty()
            for (let i = 0; i < 1000; i++) {
                inventory.addQuantity(`item-${i}`, i)
            }
            expect(inventory.getItems()).toHaveLength(999) // 1000 - 1 because item-0 has quantity 0
        })

        test("handles fractional values (after multiple operations)", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.removeQuantity("stone", 33)
            inventory.removeQuantity("stone", 33)
            inventory.removeQuantity("stone", 33)
            expect(inventory.getQuantity("stone")).toBe(1)
        })

        test("operations with zero work correctly", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 0)
            inventory.addQuantity("stone", 0)
            expect(inventory.getQuantity("stone")).toBe(0)
            expect(inventory.isEmpty()).toBe(true)
        })
    })

    describe("multi-item operations", () => {
        test("multiple items can coexist and be queried independently", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 50)
            inventory.addQuantity("coal", 75)

            expect(inventory.getQuantity("stone")).toBe(100)
            expect(inventory.getQuantity("iron-ore")).toBe(50)
            expect(inventory.getQuantity("coal")).toBe(75)

            inventory.removeQuantity("stone", 25)
            expect(inventory.getQuantity("stone")).toBe(75)
            expect(inventory.getQuantity("iron-ore")).toBe(50)
        })

        test("getItems returns consistent results", () => {
            const inventory = InventoryState.empty()
            inventory.addQuantity("stone", 100)
            inventory.addQuantity("iron-ore", 50)
            inventory.addQuantity("coal", 0)

            const items1 = inventory.getItems()
            const items2 = inventory.getItems()

            expect(items1).toEqual(items2)
        })
    })
})
