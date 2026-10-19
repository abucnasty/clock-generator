-- Helper Functions for Clock Generator Sidecar
-- Shared utility functions used across extraction and export modules.

local debug = false

local helpers = {}

---Get the default belt stack size for a force (1 + researched bonus)
---@param force LuaForce|nil The force to check
---@return number The default belt stack size
function helpers.get_default_belt_stack_size(force)
    if force then
        return 1 + (force.belt_stack_size_bonus or 0)
    end
    return 1
end

---Determine the target type for an entity
---@param entity LuaEntity
---@return "machine"|"belt"|"chest"|nil
function helpers.get_target_type(entity)
    if not entity or not entity.valid then
        return nil
    end
    
    local entity_type = entity.type

    if debug then
        helpers.print("entity type: " .. entity_type)
    end
    
    -- Machines (entities that can craft)
    if entity_type == "assembling-machine" then
        return "machine"
    end
    if entity_type == "furnace" then
        return "machine"
    end
    if entity_type == "lab" then
        return "machine"
    end
    
    -- Belts
    if entity_type == "transport-belt" or entity_type == "underground-belt" or 
       entity_type == "splitter" or entity_type == "loader" or entity_type == "loader-1x1" then
        return "belt"
    end
    
    -- Containers/Chests
    if entity_type == "container" or entity_type == "logistic-container" or 
       entity_type == "linked-container" or entity_type == "infinity-container" then
        return "chest"
    end
    
    return nil
end

---Preferred pickup lane: 1 for the left lane in belt travel direction, 2 for the right one.
---Beside a belt this is the nearest lane; supported inline underground approaches depend on mirroring.
---Other inline pickups and unsupported pieces remain unclassified. Recorded in Factorio 2.1.21.
---@param inserter LuaEntity
---@param belt LuaEntity The belt piece the inserter picks up from
---@return 1|2|nil
function helpers.get_near_lane(inserter, belt)
    if not belt or not belt.valid or not (belt.type == "underground-belt"
        or (belt.type == "transport-belt" and belt.belt_shape == "straight")) then
        return nil
    end
    -- the direction the belt runs in; y points south
    local run = {
        [defines.direction.north] = { x = 0, y = -1 },
        [defines.direction.east] = { x = 1, y = 0 },
        [defines.direction.south] = { x = 0, y = 1 },
        [defines.direction.west] = { x = -1, y = 0 },
    }
    local direction = run[belt.direction]
    if not direction then
        return nil
    end
    -- how far the inserter is to the left of the belt: left of (x, y) is (y, -x)
    local dx, dy = inserter.position.x - belt.position.x, inserter.position.y - belt.position.y
    local left = dx * direction.y - dy * direction.x
    if left > 0.25 then
        return 1
    end
    if left < -0.25 then
        return 2
    end
    -- Centered downstream and facing back into either underground endpoint, neither lane is nearer.
    -- A mirrored hand reaches the right lane first (measured northbound exit and eastbound entrance).
    local facing = run[inserter.direction]
    if belt.type == "underground-belt"
        and math.abs(left) < 0.01 and dx * direction.x + dy * direction.y > 0.25
        and facing and facing.x == -direction.x and facing.y == -direction.y then
        return inserter.mirroring and 2 or 1
    end
    -- Upstream of an exit, reaching across the hood with the belt's direction. The measured preference is
    -- again lane 1 unmirrored / lane 2 mirrored. An upstream entrance remains unclassified.
    if belt.type == "underground-belt" and belt.belt_to_ground_type == "output"
        and math.abs(left) < 0.01 and dx * direction.x + dy * direction.y < -0.25
        and facing and facing.x == direction.x and facing.y == direction.y then
        return inserter.mirroring and 2 or 1
    end
    return nil
end

---Exposed line length at a supported pickup; internal underground transport lines are not pickup space.
---@param inserter LuaEntity
---@param belt LuaEntity
---@return number|nil
function helpers.get_pickup_length(inserter, belt)
    if not helpers.get_near_lane(inserter, belt) then return nil end
    local length = belt.get_transport_line(1).line_length
    if length == 0.5 or length == 1 then return length end
    return nil
end

---Physical approach, distinct from exposed length and supply motion.
function helpers.get_pickup_layout(inserter, belt)
    if not helpers.get_near_lane(inserter, belt) then return nil end
    if belt.type == "transport-belt" then return "side-straight" end
    local run = {
        [defines.direction.north] = { x = 0, y = -1 },
        [defines.direction.east] = { x = 1, y = 0 },
        [defines.direction.south] = { x = 0, y = 1 },
        [defines.direction.west] = { x = -1, y = 0 },
    }
    local direction = run[belt.direction]
    local dx, dy = inserter.position.x - belt.position.x, inserter.position.y - belt.position.y
    local side = math.abs(dx * direction.y - dy * direction.x) > 0.25
    local endpoint = belt.belt_to_ground_type == "input" and "entrance" or "exit"
    if not side and dx * direction.x + dy * direction.y < -0.25 then return "over-hood-exit" end
    return (side and "side-" or "front-") .. endpoint
end

---Why capture cannot classify a belt pickup. Never infer geometry from an unsupported piece or observed motion.
function helpers.get_pickup_problem(inserter, belt)
    if belt.type == "transport-belt" and belt.belt_shape ~= "straight" then return "bend" end
    if belt.type == "splitter" or belt.type == "lane-splitter" then return "splitter" end
    if belt.type ~= "transport-belt" and belt.type ~= "underground-belt" then return "unsupported" end
    if not helpers.get_near_lane(inserter, belt) then return "inline" end
    if not helpers.get_pickup_length(inserter, belt) then return "unsupported" end
    return nil
end

---Get the primary ingredient and max stack size from a transport line
---@param transport_line LuaTransportLine
---@param default_stack_size number? The default stack size to use if no items are found (default 1)
---@return string|nil ingredient The primary ingredient name, or nil
---@return number stack_size The maximum stack size found on this lane, or default_stack_size
function helpers.get_lane_info(transport_line, default_stack_size)
    default_stack_size = default_stack_size or 1
    
    if not transport_line or not transport_line.valid then
        return nil, default_stack_size
    end
    
    local contents = transport_line.get_contents()
    if not contents or #contents == 0 then
        return nil, default_stack_size
    end
    
    -- Get the first item found on this lane
    -- contents is an array of {name, quality, count}
    local first_item = contents[1]
    local ingredient = first_item and first_item.name or nil
    
    -- Get max stack size from detailed contents
    local max_stack = 1
    local detailed = transport_line.get_detailed_contents()
    if detailed then
        for _, item_info in pairs(detailed) do
            if item_info.stack and item_info.stack.valid and item_info.stack.count then
                max_stack = math.max(max_stack, item_info.stack.count)
            end
        end
    end
    
    return ingredient, max_stack
end

--- Get the active recipe or previous recipe for an entity
---@return LuaRecipePrototype|nil
function helpers.get_recipe_or_previous(entity)
    -- Get recipe (fallback to previous_recipe for furnaces that may not have an active recipe)
    local recipe = entity.get_recipe()

    -- previous_recipe exists on furnaces only: reading it on any other entity raises an error
    if not recipe and entity.type == "furnace" and entity.previous_recipe then
        -- previous_recipe returns RecipeIDAndQualityIDPair with .name (RecipeID union) and .quality
        recipe = helpers.resolve_recipe_id(entity.previous_recipe.name)
    end

    return recipe
end

---Resolve a RecipeID union type to a LuaRecipePrototype
---@param recipe_id LuaRecipePrototype|LuaRecipe|string
---@return LuaRecipePrototype|nil
function helpers.resolve_recipe_id(recipe_id)
    if not recipe_id then
        return nil
    end

    -- If it's a string, look up the prototype
    if type(recipe_id) == "string" then
        return prototypes.recipe[recipe_id]
    end

    -- If it's a LuaRecipe or LuaRecipePrototype object, it has a .name property
    -- LuaRecipe has .prototype, LuaRecipePrototype does not
    if type(recipe_id) == "table" or type(recipe_id) == "userdata" then
        if recipe_id.object_name == "LuaRecipe" then
            return recipe_id.prototype
        end
        if recipe_id.object_name == "LuaRecipePrototype" then
            return recipe_id
        end
        if recipe_id.name then
            return prototypes.recipe[recipe_id.name]
        end
    end

    return nil
end

---Normalize belt name to transport belt type (converts underground belts and splitters)
---@param name string The entity name (e.g., "turbo-underground-belt", "fast-splitter")
---@return string The normalized transport belt name (e.g., "turbo-transport-belt", "fast-transport-belt")
function helpers.normalize_belt_type(name)
    -- Map underground belts to transport belts
    local underground_to_belt = {
        ["underground-belt"] = "transport-belt",
        ["fast-underground-belt"] = "fast-transport-belt",
        ["express-underground-belt"] = "express-transport-belt",
        ["turbo-underground-belt"] = "turbo-transport-belt"
    }
    
    -- Map splitters to transport belts
    local splitter_to_belt = {
        ["splitter"] = "transport-belt",
        ["fast-splitter"] = "fast-transport-belt",
        ["express-splitter"] = "express-transport-belt",
        ["turbo-splitter"] = "turbo-transport-belt"
    }
    
    return underground_to_belt[name] or splitter_to_belt[name] or name
end


function helpers.print(...)
    if debug then
        local args = {...}
        for i, v in ipairs(args) do
            args[i] = tostring(v)
        end
        game.print("[ClockGen] " .. table.concat(args, " "))
    end
end

return helpers
