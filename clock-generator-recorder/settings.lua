data:extend({
    {
        type = "int-setting",
        name = "clock-generator-recorder-periods",
        setting_type = "runtime-global",
        default_value = 2,
        minimum_value = 1,
        maximum_value = 100000,
        order = "a"
    },
    {
        type = "int-setting",
        name = "clock-generator-recorder-minimum-ticks",
        setting_type = "runtime-global",
        default_value = 0,
        minimum_value = 0,
        maximum_value = 216000,
        order = "ab"
    },
    {
        type = "int-setting",
        name = "clock-generator-recorder-ticks-without-clock",
        setting_type = "runtime-global",
        default_value = 600,
        minimum_value = 1,
        maximum_value = 216000,
        order = "b"
    }
})
