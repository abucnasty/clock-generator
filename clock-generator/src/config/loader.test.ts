import { describe, it, expect } from "vitest";
import { parseConfig, parseConfigSafe } from "./loader";
import { ConfigValidationError } from "./errors";
import { BeltType } from "../common/entity-types";
import { MiningDrillType } from "../entities";

describe("parseConfig", () => {
    describe("valid configurations", () => {
        it("should parse a minimal valid config", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 2,
                    "items_per_second": 1.5,
                    "recipe": "electronic-circuit"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.target_output.recipe).toBe("electronic-circuit");
            expect(config.target_output.items_per_second).toBe(1.5);
            expect(config.target_output.copies).toBe(2);
            expect(config.machines).toEqual([]);
            expect(config.inserters).toEqual([]);
            expect(config.belts).toEqual([]);
            expect(config.drills).toBeUndefined();
            expect(config.overrides).toBeUndefined();
            expect(config.chests).toBeUndefined();
        });

        it("should parse a config with machines", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [
                    {
                        "crafting_speed": 1.25,
                        "id": 1,
                        "productivity": 0.5,
                        "recipe": "iron-gear-wheel",
                        "type": "machine"
                    }
                ],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 2,
                    "recipe": "iron-gear-wheel"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.machines).toHaveLength(1);
            expect(config.machines[0]).toEqual({
                id: 1,
                recipe: "iron-gear-wheel",
                productivity: 0.5,
                crafting_speed: 1.25,
                // the former type, read as a machine of that rule that makes the recipe
                prototype: "assembling-machine-3"
            });
        });

        it("should parse a config with inserters (belt source)", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 3
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "electronic-circuit"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.inserters).toHaveLength(1);
            expect(config.inserters[0].source).toEqual({ type: "belt", id: 1, pickup_length: 1 });
            expect(config.inserters[0].sink).toEqual({ type: "machine", id: 1 });
            expect(config.inserters[0].stack_size).toBe(3);
        });

        it("should parse a config with inserters (machine to machine)", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "filters": [
                            "iron-plate",
                            "copper-plate"
                        ],
                        "overrides": {
                            "animation": {
                                "pickup_duration_ticks": 10
                            }
                        },
                        "sink": {
                            "id": 2,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "machine"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "electronic-circuit"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.inserters[0].source).toEqual({ type: "machine", id: 1 });
            expect(config.inserters[0].sink).toEqual({ type: "machine", id: 2 });
            expect(config.inserters[0].filters).toEqual(["iron-plate", "copper-plate"]);
            expect(config.inserters[0].overrides?.animation?.pickup_duration_ticks).toBe(10);
        });

        it("should parse a config with belts (single lane)", async () => {
            const json = `{
                "belts": [
                    {
                        "id": 1,
                        "lanes": [
                            {
                                "ingredient": "iron-plate",
                                "stack_size": 4
                            }
                        ],
                        "type": "express-transport-belt"
                    }
                ],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "electronic-circuit"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.belts).toHaveLength(1);
            expect(config.belts[0].id).toBe(1);
            expect(config.belts[0].type).toBe("express-transport-belt");
            expect(config.belts[0].lanes).toHaveLength(1);
            expect(config.belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 4 });
        });

        it("should parse a config with belts (two lanes)", async () => {
            const json = `{
                "belts": [
                    {
                        "id": 1,
                        "lanes": [
                            {
                                "ingredient": "iron-plate",
                                "stack_size": 4
                            },
                            {
                                "ingredient": "copper-plate",
                                "stack_size": 4
                            }
                        ],
                        "type": "turbo-transport-belt"
                    }
                ],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "electronic-circuit"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.belts[0].lanes).toHaveLength(2);
            expect(config.belts[0].lanes[1]).toEqual({ ingredient: "copper-plate", stack_size: 4 });
        });

        it("should parse a config with drills", async () => {
            const json = `{
                "belts": [],
                "drills": {
                    "configs": [
                        {
                            "id": 1,
                            "mined_item_name": "iron-ore",
                            "speed_bonus": 0.5,
                            "productivity": 500,
                            "target": {
                                "id": 1,
                                "type": "machine"
                            },
                            "type": "electric-mining-drill"
                        }
                    ]
                },
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "iron-plate"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.drills).toBeDefined();
            expect(config.drills?.configs).toHaveLength(1);
            expect(config.drills?.configs[0]).toEqual({
                id: 1,
                type: "electric-mining-drill",
                mined_item_name: "iron-ore",
                speed_bonus: 0.5,
                productivity: 500,
                target: { type: "machine", id: 1 }
            });
        });

        it("should parse a config with overrides", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "overrides": {
                    "lcm": 120,
                    "terminal_swing_count": 10
                },
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "electronic-circuit"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.overrides?.lcm).toBe(120);
            expect(config.overrides?.terminal_swing_count).toBe(10);
        });

        it("should parse inserter enable_control override with AUTO mode", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "overrides": {
                            "enable_control": {
                                "mode": "AUTO"
                            }
                        },
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.inserters[0].overrides?.enable_control).toBeDefined();
            expect(config.inserters[0].overrides?.enable_control?.mode).toBe("AUTO");
        });

        it("should parse inserter enable_control override with ALWAYS mode", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "overrides": {
                            "enable_control": {
                                "mode": "ALWAYS"
                            }
                        },
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.inserters[0].overrides?.enable_control?.mode).toBe("ALWAYS");
        });

        it("should parse inserter enable_control override with NEVER mode", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "overrides": {
                            "enable_control": {
                                "mode": "NEVER"
                            }
                        },
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.inserters[0].overrides?.enable_control?.mode).toBe("NEVER");
        });

        it("should parse inserter enable_control override with CLOCKED mode", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "overrides": {
                            "enable_control": {
                                "mode": "CLOCKED",
                                "period_duration_ticks": 500,
                                "ranges": [
                                    {
                                        "end": 100,
                                        "start": 0
                                    },
                                    {
                                        "end": 300,
                                        "start": 200
                                    }
                                ]
                            }
                        },
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            const enableControl = config.inserters[0].overrides?.enable_control;
            expect(enableControl?.mode).toBe("CLOCKED");
            if (enableControl?.mode === "CLOCKED") {
                expect(enableControl.ranges).toHaveLength(2);
                expect(enableControl.ranges[0]).toEqual({ start: 0, end: 100 });
                expect(enableControl.ranges[1]).toEqual({ start: 200, end: 300 });
                expect(enableControl.period_duration_ticks).toBe(500);
            }
        });

        it("should parse inserter enable_control CLOCKED mode without optional period_duration_ticks", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "overrides": {
                            "enable_control": {
                                "mode": "CLOCKED",
                                "ranges": [
                                    {
                                        "end": 50,
                                        "start": 0
                                    }
                                ]
                            }
                        },
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            const enableControl = config.inserters[0].overrides?.enable_control;
            expect(enableControl?.mode).toBe("CLOCKED");
            if (enableControl?.mode === "CLOCKED") {
                expect(enableControl.ranges).toHaveLength(1);
                expect(enableControl.period_duration_ticks).toBeUndefined();
            }
        });

        it("should parse inserter with both animation and enable_control overrides", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "overrides": {
                            "animation": {
                                "pickup_duration_ticks": 15
                            },
                            "enable_control": {
                                "mode": "ALWAYS"
                            }
                        },
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "belt"
                        },
                        "stack_size": 4
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.inserters[0].overrides?.animation?.pickup_duration_ticks).toBe(15);
            expect(config.inserters[0].overrides?.enable_control?.mode).toBe("ALWAYS");
        });

        it("should parse drill enable_control override", async () => {
            const json = `{
                "belts": [],
                "drills": {
                    "configs": [
                        {
                            "id": 1,
                            "mined_item_name": "iron-ore",
                            "overrides": {
                                "enable_control": {
                                    "mode": "ALWAYS"
                                }
                            },
                            "speed_bonus": 0.5,
                            "productivity": 500,
                            "target": {
                                "id": 1,
                                "type": "machine"
                            },
                            "type": "electric-mining-drill"
                        }
                    ]
                },
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            expect(config.drills?.configs[0].overrides?.enable_control?.mode).toBe("ALWAYS");
        });

        it("should parse drill enable_control override with CLOCKED mode", async () => {
            const json = `{
                "belts": [],
                "drills": {
                    "configs": [
                        {
                            "id": 1,
                            "mined_item_name": "iron-ore",
                            "overrides": {
                                "enable_control": {
                                    "mode": "CLOCKED",
                                    "ranges": [
                                        {
                                            "end": 60,
                                            "start": 10
                                        }
                                    ]
                                }
                            },
                            "speed_bonus": 0.5,
                            "productivity": 500,
                            "target": {
                                "id": 1,
                                "type": "machine"
                            },
                            "type": "electric-mining-drill"
                        }
                    ]
                },
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);

            const enableControl = config.drills?.configs[0].overrides?.enable_control;
            expect(enableControl?.mode).toBe("CLOCKED");
            if (enableControl?.mode === "CLOCKED") {
                expect(enableControl.ranges).toHaveLength(1);
                expect(enableControl.ranges[0]).toEqual({ start: 10, end: 60 });
            }
        });

        it("should parse all belt types", async () => {
            const beltTypes = Object.values(BeltType)

            for (const beltType of beltTypes) {
                const json = `{
                "belts": [
                    {
                        "id": 1,
                        "lanes": [
                            {
                                "ingredient": "iron-plate",
                                "stack_size": 1
                            }
                        ],
                        "type": "${beltType}"
                    }
                ],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

                const config = await parseConfig(json);
                expect(config.belts[0].type).toBe(beltType);
            }
        });

        it("should parse all drill types", async () => {
            const drillTypes = Object.values(MiningDrillType);
            for (const drillType of drillTypes) {
                const json = `{
                "belts": [],
                "drills": {
                    "configs": [
                        {
                            "id": 1,
                            "mined_item_name": "iron-ore",
                            "speed_bonus": 0,
                            "productivity": 0,
                            "target": {
                                "id": 1,
                                "type": "machine"
                            },
                            "type": "${drillType}"
                        }
                    ]
                },
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

                const config = await parseConfig(json);
                expect(config.drills?.configs[0].type).toBe(drillType);
            }
        });
    });

    describe("validation errors", () => {
        it("should throw ConfigValidationError for missing required fields", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "recipe": "electronic-circuit"
                }
            }`;

            await expect(parseConfig(json)).rejects.toThrow(ConfigValidationError);
        });

        it("should throw ConfigValidationError for invalid types", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": "not a number",
                    "recipe": "electronic-circuit"
                }
            }`;

            await expect(parseConfig(json)).rejects.toThrow(ConfigValidationError);
        });

        it("should throw ConfigValidationError for invalid belt type", async () => {
            const json = `{
                "belts": [
                    {
                        "id": 1,
                        "lanes": [
                            {
                                "ingredient": "iron-plate",
                                "stack_size": 1
                            }
                        ],
                        "type": "invalid-belt-type"
                    }
                ],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            await expect(parseConfig(json)).rejects.toThrow(ConfigValidationError);
        });

        it("should throw ConfigValidationError for invalid drill type", async () => {
            const json = `{
                "belts": [],
                "drills": {
                    "configs": [
                        {
                            "id": 1,
                            "mined_item_name": "iron-ore",
                            "speed_bonus": 0,
                            "productivity": 0,
                            "target": {
                                "id": 1,
                                "type": "machine"
                            },
                            "type": "invalid-drill-type"
                        }
                    ]
                },
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            await expect(parseConfig(json)).rejects.toThrow(ConfigValidationError);
        });

        it("should throw ConfigValidationError for invalid inserter source type", async () => {
            const json = `{
                "belts": [],
                "inserters": [
                    {
                        "sink": {
                            "id": 1,
                            "type": "machine"
                        },
                        "source": {
                            "id": 1,
                            "type": "invalid"
                        },
                        "stack_size": 1
                    }
                ],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            await expect(parseConfig(json)).rejects.toThrow(ConfigValidationError);
        });

        it("should provide detailed error messages", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": -1,
                    "recipe": "electronic-circuit"
                }
            }`;

            try {
                await parseConfig(json);
                expect.fail("Should have thrown");
            } catch (error) {
                expect(error).toBeInstanceOf(ConfigValidationError);
                const validationError = error as ConfigValidationError;
                expect(validationError.issues).toHaveLength(1);
                expect(validationError.issues[0].path).toContain("items_per_second");
            }
        });

        it("should report multiple errors", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": "not an array",
                "target_output": {
                    "items_per_second": "invalid",
                    "machines": -1,
                    "recipe": 123
                }
            }`;

            try {
                await parseConfig(json);
                expect.fail("Should have thrown");
            } catch (error) {
                expect(error).toBeInstanceOf(ConfigValidationError);
                const validationError = error as ConfigValidationError;
                expect(validationError.issues.length).toBeGreaterThan(1);
            }
        });
    });

    describe("edge cases", () => {
        it("should handle empty arrays", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);
            expect(config.machines).toEqual([]);
            expect(config.inserters).toEqual([]);
            expect(config.belts).toEqual([]);
        });

        it("should handle optional fields being omitted", async () => {
            const json = `{
                "belts": [],
                "inserters": [],
                "machines": [
                    {
                        "crafting_speed": 1,
                        "id": 1,
                        "productivity": 0,
                        "recipe": "test"
                    }
                ],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);
            expect(config.machines[0]).not.toHaveProperty("type");
            expect(config.drills).toBeUndefined();
            expect(config.overrides).toBeUndefined();
        });

        it("should handle zero values where allowed", async () => {
            const json = `{
                "belts": [],
                "drills": {
                    "configs": [
                        {
                            "id": 1,
                            "mined_item_name": "iron-ore",
                            "speed_bonus": 0,
                            "productivity": 0,
                            "target": {
                                "id": 1,
                                "type": "machine"
                            },
                            "type": "electric-mining-drill"
                        }
                    ]
                },
                "inserters": [],
                "machines": [
                    {
                        "crafting_speed": 1,
                        "id": 1,
                        "productivity": 0,
                        "recipe": "test"
                    }
                ],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

            const config = await parseConfig(json);
            expect(config.machines[0].productivity).toBe(0);
            expect(config.drills?.configs[0].productivity).toBe(0);
            expect(config.drills?.configs[0].speed_bonus).toBe(0);
        });
    });
});

describe("parseConfigSafe", () => {
    it("should return success result for valid config", async () => {
        const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": "test"
                }
            }`;

        const result = await parseConfigSafe(json);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.config.target_output.recipe).toBe("test");
        }
    });

    it("should return failure result for invalid config", async () => {
        const json = `{
                "machines": [],
                "target_output": {
                    "recipe": "test"
                }
            }`;

        const result = await parseConfigSafe(json);

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBeInstanceOf(ConfigValidationError);
            expect(result.error.issues.length).toBeGreaterThan(0);
        }
    });
});

describe("ConfigValidationError", () => {
    it("should format single error nicely", async () => {
        const json = `{
                "belts": [],
                "inserters": [],
                "machines": [],
                "target_output": {
                    "copies": 1,
                    "items_per_second": 1,
                    "recipe": 123
                }
            }`;

        try {
            await parseConfig(json);
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigValidationError);
            const validationError = error as ConfigValidationError;
            expect(validationError.message).toContain("recipe");
        }
    });

    it("should provide getFormattedIssues method", async () => {
        const json = `{
                "machines": [],
                "target_output": {
                    "recipe": "test"
                }
            }`;

        try {
            await parseConfig(json);
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigValidationError);
            const validationError = error as ConfigValidationError;
            const formatted = validationError.getFormattedIssues();
            expect(typeof formatted).toBe("string");
            expect(formatted.length).toBeGreaterThan(0);
        }
    });
});

describe("a drop spot on a belt", () => {
    const inserter = (id: number, sink: object, source: object = { type: "machine", id: 1 }) =>
        ({ id, source, sink });
    const config = (inserters: object[]) => JSON.stringify({
        belts: [{ id: 3, type: "turbo-transport-belt", lanes: [{ ingredient: "utility-science-pack", stack_size: 4 }] }],
        inserters,
        machines: [],
        target_output: { copies: 1, items_per_second: 1, recipe: "utility-science-pack" }
    });
    const drop = (position: number) => ({ type: "belt", id: 3, drop: { lane: 1, position } });

    it("parses on the sink of every inserter that drops on the belt", async () => {
        const parsed = await parseConfig(config([inserter(1, drop(0.5)), inserter(2, drop(6.5))]));

        expect(parsed.inserters.map(it => it.sink)).toEqual([drop(0.5), drop(6.5)]);
    });

    it("takes a negative or fractional position, as only the distances between the positions count", async () => {
        const parsed = await parseConfig(config([inserter(1, drop(-94)), inserter(2, drop(-87.5))]));

        expect(parsed.inserters.map(it => it.sink)).toEqual([drop(-94), drop(-87.5)]);
    });

    it("is not needed: a config without it parses as before", async () => {
        const parsed = await parseConfig(config([inserter(1, { type: "belt", id: 3 })]));

        expect(parsed.inserters[0].sink).toEqual({ type: "belt", id: 3 });
    });

    it("is refused when some inserters that drop on the belt have it and others do not, naming the others", async () => {
        const result = await parseConfigSafe(config([
            inserter(1, drop(0.5)),
            inserter(2, { type: "belt", id: 3 }),
            inserter(5, { type: "belt", id: 3 })
        ]));

        expect(result.success).toBe(false);
        if (!result.success) {
            const message = result.error.getFormattedIssues();
            expect(message).toContain("Belt 3: inserter 2, 5");
            expect(message).toContain("without `drop`");
        }
    });

    it("is refused on a lane that is not 1 or 2", async () => {
        const result = await parseConfigSafe(config([inserter(1, { type: "belt", id: 3, drop: { lane: 3, position: 1 } })]));

        expect(result.success).toBe(false);
    });

    it("is refused on the source of an inserter", async () => {
        const result = await parseConfigSafe(config([
            inserter(1, { type: "machine", id: 2 }, { type: "belt", id: 3, drop: { lane: 1, position: 1 } })
        ]));

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.getFormattedIssues()).toContain("belongs on the sink, not on the source");
        }
    });
});
