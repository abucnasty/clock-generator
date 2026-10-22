-- Clock Generator Sidecar - Data Stage
-- Defines the selection tool prototype for selecting machines

data:extend({
    -- Selection tool for extracting crafting speeds
    {
        type = "selection-tool",
        name = "clock-generator-sidecar",
        icon = "__clock-generator-sidecar__/graphics/bbq_right.png",
        icon_size = 64,
        subgroup = "tool",
        order = "c[automated-construction]-d[clock-generator-sidecar]",
        stack_size = 1,
        select = {
            border_color = { r = 0, g = 1, b = 0.5 },
            cursor_box_type = "copy",
            -- any-entity, kept to the types below: "buildable-type" takes buildings only, which leaves out cars, tanks
            -- and cargo wagons (rolling stock and vehicles are not buildings)
            mode = { "any-entity", "same-force" },
            entity_type_filters = { "assembling-machine", "furnace", "mining-drill", "lab", "inserter", "transport-belt", "underground-belt", "splitter", "container", "logistic-container", "infinity-container", "linked-container", "car", "cargo-wagon", "rocket-silo" }
        },
        alt_select = {
            border_color = { r = 1, g = 0.5, b = 0 },
            cursor_box_type = "copy",
            -- any-entity, kept to the types below: "buildable-type" takes buildings only, which leaves out cars, tanks
            -- and cargo wagons (rolling stock and vehicles are not buildings)
            mode = { "any-entity", "same-force" },
            entity_type_filters = { "assembling-machine", "furnace", "mining-drill", "lab", "inserter", "transport-belt", "underground-belt", "splitter", "container", "logistic-container", "infinity-container", "linked-container", "car", "cargo-wagon", "rocket-silo" }
        },
        flags = { "only-in-cursor", "spawnable" }
    },

    -- Shortcut button for quick access
    {
        type = "shortcut",
        name = "clock-generator-sidecar-shortcut",
        action = "spawn-item",
        item_to_spawn = "clock-generator-sidecar",
        icon = "__clock-generator-sidecar__/graphics/bbq_right.png",
        icon_size = 64,
        small_icon = "__clock-generator-sidecar__/graphics/bbq_right.png",
        small_icon_size = 64,
        associated_control_input = "clock-generator-sidecar-toggle"
    },

    -- Custom input for keyboard shortcut
    {
        type = "custom-input",
        name = "clock-generator-sidecar-toggle",
        key_sequence = "ALT + E",
        action = "spawn-item",
        item_to_spawn = "clock-generator-sidecar"
    }
})
