-- Clock Generator Recorder - Data Stage

data:extend({
    -- Select a running clock to record; alt-select stops an active recording
    {
        type = "selection-tool",
        name = "clock-generator-recorder",
        icon = "__clock-generator-recorder__/graphics/pipe_q3.png",
        icon_size = 64,
        subgroup = "tool",
        order = "c[automated-construction]-e[clock-generator-recorder]",
        stack_size = 1,
        select = {
            border_color = { r = 1, g = 0.2, b = 0.2 },
            cursor_box_type = "copy",
            mode = { "buildable-type", "same-force" },
            entity_type_filters = { "assembling-machine", "furnace", "mining-drill", "lab", "inserter", "transport-belt", "underground-belt", "splitter", "container", "logistic-container", "infinity-container", "linked-container", "decider-combinator" }
        },
        alt_select = {
            border_color = { r = 1, g = 1, b = 0 },
            cursor_box_type = "not-allowed",
            mode = { "nothing" }
        },
        flags = { "only-in-cursor", "spawnable" }
    },

    {
        type = "shortcut",
        name = "clock-generator-recorder-shortcut",
        action = "spawn-item",
        item_to_spawn = "clock-generator-recorder",
        icon = "__clock-generator-recorder__/graphics/pipe_q3.png",
        icon_size = 64,
        small_icon = "__clock-generator-recorder__/graphics/pipe_q3.png",
        small_icon_size = 64,
        associated_control_input = "clock-generator-recorder-toggle"
    },

    {
        type = "custom-input",
        name = "clock-generator-recorder-toggle",
        key_sequence = "CONTROL + ALT + E",
        action = "spawn-item",
        item_to_spawn = "clock-generator-recorder"
    }
})
