-- Suggested Target for Clock Generator Sidecar
-- The product that leaves a selection and what its machines make of it per second at their maximum.
--
-- This mirrors inferSuggestedTarget in clock-generator/src/config/suggested-target.ts, which is the tested reference;
-- change both together. Only the exported machines are used, so the two agree:
--
-- 1. The machines are grouped by recipe; an unknown recipe, or one without an item product, is skipped.
-- 2. A recipe's product is its main product: the item product with the largest expected amount per craft (amount, or
--    the middle of amount_min and amount_max, times its probability); the first wins a tie.
-- 3. A recipe is intermediate when another recipe of the selection has its product as an ingredient. By-products do
--    not count, nor does a recipe consuming its own product.
-- 4. The others are final; when every recipe is intermediate (a circle) there is no suggestion.
-- 5. Of several final recipes, the one whose machines make the most per second; on an exact tie, the one whose product
--    name sorts first, then the one whose recipe name does.
-- 6. Its rate is the sum over its machines of crafting_speed / energy * ((amount - ignored) * (1 + productivity / 100)
--    + ignored), the main product's amount and the part of it productivity ignores, as the clock generator's machine
--    facts work it out (without the probability); copies is 1.

require("__clock-generator-sidecar__.scripts.types")

local suggested_target = {}

---The amount of a product per craft, before probability
---@param product table An ItemProduct
---@return number
local function amount_of(product)
    if product.amount then
        return product.amount
    end
    return ((product.amount_min or 0) + (product.amount_max or 0)) / 2
end

---The main product of a recipe: the item product with the largest expected amount per craft, the first on a tie
---@param recipe LuaRecipePrototype
---@return table|nil product The ItemProduct, nil when the recipe has no item product
local function main_product_of(recipe)
    local best = nil
    local best_expected = nil
    for _, product in ipairs(recipe.products or {}) do
        if product.type == "item" then
            local probability = product.independent_probability or product.probability or 1
            local expected = amount_of(product) * probability
            if best == nil or expected > best_expected then
                best = product
                best_expected = expected
            end
        end
    end
    return best
end

---What one machine makes of its recipe's main product per second
---@param machine MachineData
---@param energy number The recipe's crafting time at speed 1
---@param product table The recipe's main product
---@return number
local function output_rate_of(machine, energy, product)
    local amount = amount_of(product)
    local ignored = product.ignored_by_productivity or 0
    local per_craft = (amount - ignored) * (1 + (machine.productivity or 0) / 100) + ignored
    return machine.crafting_speed / energy * per_craft
end

---The suggested target for these machines, nil when there is no final product
---@param machines MachineData[]
---@return SuggestedTarget|nil
function suggested_target.find(machines)
    -- the machines of each recipe, with the recipe names sorted so nothing depends on the order of the selection
    local by_recipe = {}
    local recipe_names = {}
    for _, machine in ipairs(machines or {}) do
        if machine.recipe then
            if not by_recipe[machine.recipe] then
                by_recipe[machine.recipe] = {}
                table.insert(recipe_names, machine.recipe)
            end
            table.insert(by_recipe[machine.recipe], machine)
        end
    end
    table.sort(recipe_names)

    local groups = {}
    for _, recipe_name in ipairs(recipe_names) do
        local recipe = prototypes.recipe[recipe_name]
        local product = recipe and main_product_of(recipe)
        local energy = recipe and recipe.energy
        if product and energy and energy > 0 then
            local rate = 0
            local counted = 0
            for _, machine in ipairs(by_recipe[recipe_name]) do
                local machine_rate = output_rate_of(machine, energy, product)
                -- a rate that is not a positive number (NaN fails both tests) is skipped, as on the site
                if machine_rate > 0 and machine_rate < math.huge then
                    rate = rate + machine_rate
                    counted = counted + 1
                end
            end
            if counted > 0 then
                local ingredients = {}
                for _, ingredient in ipairs(recipe.ingredients or {}) do
                    ingredients[ingredient.name] = true
                end
                table.insert(groups, {
                    recipe = recipe_name,
                    product = product.name,
                    ingredients = ingredients,
                    items_per_second = rate
                })
            end
        end
    end

    local best = nil
    for _, group in ipairs(groups) do
        local intermediate = false
        for _, other in ipairs(groups) do
            if other.recipe ~= group.recipe and other.ingredients[group.product] then
                intermediate = true
                break
            end
        end
        if not intermediate then
            if best == nil
                or group.items_per_second > best.items_per_second
                or (group.items_per_second == best.items_per_second and group.product < best.product)
                or (group.items_per_second == best.items_per_second and group.product == best.product and group.recipe < best.recipe) then
                best = group
            end
        end
    end

    if not best then
        return nil
    end
    ---@type SuggestedTarget
    return {
        recipe = best.product,
        items_per_second = best.items_per_second,
        copies = 1
    }
end

return suggested_target
