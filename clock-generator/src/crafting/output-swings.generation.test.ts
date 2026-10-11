import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, generateClockAlternatives, type BlueprintGenerationResult, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { EntityId } from "../entities";
import { OpenRange } from "../data-types";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    // 4 output swings per 64 tick cycle is the optimal clock; the planner alone only reaches 2 swings
    describe("forced output swing count", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_DI);
        let alternatives: ClockAlternative[];

        beforeAll(() => {
            ({ alternatives } = generateClockAlternatives(config));
        });

        it("uses the terminal_swing_count override as-is instead of backing off, for every clock alternative", () => {
            expect(config.overrides?.terminal_swing_count).toBe(2);
            // batched swings is the plan's own run, with the backoff that run has
            expect(alternatives[0].id).toBe("planned-belt-slack");
            expect(alternatives.map(a => a.result.used_terminal_swing_count).every(count => count === 2)).toBe(true);
        });
    });

    describe("fractional swings", () => {
        describe("PRODUCTION_SCIENCE_SHARED with fractional swings enabled", async () => {
            const configWithFractionalSwings = await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_SHARED_JSON);

            let result: BlueprintGenerationResult;

            beforeAll(() => {
                result = generateClockForConfig(configWithFractionalSwings);
            });

            it("has fractional_swings_enabled set to true", () => {
                expect(result.crafting_cycle_plan.fractional_swings_enabled).toBe(true);
            });

            it("has a cycle_multiplier defined", () => {
                expect(result.crafting_cycle_plan.cycle_multiplier).toBeDefined();
                expect(result.crafting_cycle_plan.cycle_multiplier).toBeGreaterThan(1);
            });

            it("has swing_distribution defined", () => {
                expect(result.crafting_cycle_plan.swing_distribution).toBeDefined();
                expect(result.crafting_cycle_plan.swing_distribution!.size).toBeGreaterThan(0);
            });

            it("swing distributions sum to correct totals", () => {
                const distribution = result.crafting_cycle_plan.swing_distribution!;
                const cycle_multiplier = result.crafting_cycle_plan.cycle_multiplier!;

                for (const [entityId, swingDist] of distribution.entries()) {
                    const sum = swingDist.swings_per_subcycle.reduce((a, b) => a + b, 0);
                    expect(sum).toBe(swingDist.total_swings);
                    expect(swingDist.swings_per_subcycle.length).toBe(cycle_multiplier);
                }
            });

            it("output inserter has fractional swing distribution", () => {
                const distribution = result.crafting_cycle_plan.swing_distribution!;
                const outputInserterDist = distribution.get("inserter:1");

                expect(outputInserterDist).toBeDefined();
                // Should have alternating distribution (values differ by at most 1)
                const swings = outputInserterDist!.swings_per_subcycle;
                const min = Math.min(...swings);
                const max = Math.max(...swings);
                expect(max - min).toBeLessThanOrEqual(1);
            });

            it("simulation duration is extended by cycle_multiplier", () => {
                const base_duration = result.crafting_cycle_plan.total_duration.ticks;
                const cycle_multiplier = result.crafting_cycle_plan.cycle_multiplier!;
                const expected_simulation_duration = base_duration * cycle_multiplier;

                expect(result.simulation_duration.ticks).toBe(expected_simulation_duration);
            });
        });

        describe("PRODUCTION_SCIENCE_SHARED without fractional swings without fractional swings", async () => {
            const config = await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_SHARED_JSON);
            const configWithoutFractionalSwings = {
                ...config,
                overrides: {
                    ...config.overrides,
                    use_fractional_swings: false
                }
            };
            let result: BlueprintGenerationResult;

            beforeAll(() => {
                result = generateClockForConfig(configWithoutFractionalSwings);
            });

            it("has fractional_swings_enabled set to false", () => {
                expect(result.crafting_cycle_plan.fractional_swings_enabled).toBe(false);
            });

            it("does not have swing_distribution defined", () => {
                expect(result.crafting_cycle_plan.swing_distribution).toBeUndefined();
            });

            it("does not have cycle_multiplier defined", () => {
                expect(result.crafting_cycle_plan.cycle_multiplier).toBeUndefined();
            });
        });

        describe("Utility Science Belted with Combined Blue and LDS", async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS);
            let result: BlueprintGenerationResult;

            beforeAll(() => {
                result = generateClockForConfig(config);
            });

            // there are two valid tick ranges for this specific configuration.
            // both have been tested to be functional in the game using the following blueprint:
            // 0eNrtXc1u5LgRfhWjTwmgzor/lIHNZXPJOQFy2DWMdlueEbatdtTqmRgTP0DeI3mxPElIqW1zbcliVc0sloyBxXZLmmapyPo+llms4pfV1e5Y33VN26/Ov6ya7b49rM5//LI6NB/azc7faze39ep8dVVv3MNVsfr7cbNr+nt3a1d/qNvrTXe/eihWTXtd/2N1zh4uilXd9k3f1GNLw8X9ZXu8vao79w+KVy3e7Q/un7uvTppvwvxBFSsnYM2k+/owLdJJ7OvbUURzHbzo4a6ur9e3++vjrl6LN154/Ln7dXvZtJ/ca+7dg6G55yv3tod+s/15dV4+FDNPnMoP7r/ilap8UVVeZqKqWFZVZKKqXFZVZ6KqWla1ykRVvaiq4JmoapZVVZmoapdVtZmoWi2qKlkmqrJyWVeZi67L/pLMxV9iyw6TysVhYssek8rFY2LLLpPKxWViyz6TysVnYstOk87FaWLLXpPOxWtiy26TzsVtYst+k8nFb+LLfpPJxW/iy36TyWadadlvsrn4TfzZb6rrddPeNK17vN7tN9fu8Su9g6lWDWpfN129Hf+B80r6+zvf0v7Y3x179+ubZtfX3akDTguaT/JudvdN+2Hd7a/2/fqm8zfDjmj33e1m525t97d3m27jVHJ3v1+NOg5tcXJbF4/veOkGwzf0+aPr811z6FdTnfXsePXH7mq/7rtNe7jbd/36qt71E0uv7K3+mpKgoBJKqAQNlSCgEgxUAodKsC8kHJ09dB+6vfuck6GiLLdpveFOiXye167rbePErZ0tXTXtYEsT4h6FyQlhjlL6br+7vKo/bj413ha/PLZ66Z5dDy0NuA+vHIZumu7QXz7HEk5v/anp+uNg34/8MvyL9Xa3d+B/GAQ6IvAxCSGUN/oRoS9DE3HN+d7BvMLdvVPu2PaXN93+9nLs6fObze5Qe3JyXbjb3LsOuK4P2665Gztr9YP//dnNvjv70ZPh98e+8ZheH7ZN3W7r9Z2jt4vzn9r12Q/321199qejQ7f76fkZ0/asb7Y/H54f/uDFn5/xs62/HB78dd9vdsGvhNDjr6aMQJRQy5ZAyxawcI5MOsbBgb3JoWwqnie34WXc/Haou35qYgvbHnt1CqTbptsem/6ybjdXu9p1a98d6+Lp9hNa/b8FYnXT3vcf3Rz2S7iWL6asP3r4zQzZa/UlmCZ5CZngp2QquExOo2ahQRGktDFj4N1bUYcUPtsKRhzSKhq4oswPuBI6zwioFygZKGiVNGYkdJ4RFbQ34+eZsO1szBU+z4RhQhQpSfg8I0saKUkNCpOljRn4PBOGzXBDCp9nZEUc0gpIDdICqUGV0dQQtp0LNSgGCssljRkFnWeUgRpT/DyjTIbGBJ9nwjgoipQUfJ5RlkZKChYGTBsz8HlGK+qQwucZbYhDCp1ntAZSg46fZ7TOjxo0A4Udk8aMhs4zRkGNKX6eMSpDY4LPM0YSSUkrUMwxbQPWyFgK/23FUtgLI/vvv/4zDC29ZVW+avrfT9HL+vLU4Ka9/krymK6+mS6cxSszG5k6SZmK/hCCS38+0doZX4ow/dT+5bMjmTGCdBjiTXfud0Mc6fxM+OveR5LOz/Qkug3S4sVvy+J5qb+hnZivZicT2wG+gpWwwEpeS1iwEfYdD6yETVrJs2O6ORzq26udF3G72br5baTsN4JWfHby7erNtTeM3ok7PE69w83P++5nP3We7p0u40fxb7Ozqhewbe5mMfv4/HJij8bM/HXXuanLoeCTb+wrTWNydhqTwTQ294TPPhGzUx/0D4EwzevV9GenslHi/xAI235FNH7zePqunGHQ/pZv9Mlkf3OCBP6616dECCAvhOGgd15IgRcMdGeZEGArUgQRcVCAbi0LUwDjyM3EB9p4/uQG9RfC4OM7LyTBC/EbIcJ0xEwN3kL3RUgGJBgL9RckB5Kk5QQJcUxvof5CGHl854UUeMFC/QXFoHaqCBIi7VTHhzPL/MkNum1elVByg/oLYRD5nReS4IV4fyFMm80UUhXUX1AVEFIV1F/QJZCHK06QEMfDFdRfCCPI77yQAi9UUH9BV1A7VQQJkXYa7y+E+dS5khvUX9AWSm5QfyHcDPDOC0nwQry/EKZ3ZwopVkIdBmOAmGIl1GMwFsjErOQEEXFUzEqBjGiz39geDvHNAto+Fe5X3cRhv92GFF6KX1cZLuS3U0aqr7bTYLf/vL6u28Mwozhy2zrELW82KCZacvPJtj4c/BR7bJv+a2xYEMOGhd+NOxYm3/Tin+PDF8Ivfv/2Zgb1i80MappLJSiVmaVdQU+hMo3LV3yexzSqCbscWNwcZwgiyphNsKy0pFTmErMNlJUVXKiMEjq7OZ1F1H8ME6jTRipjpGxm3KgGlRgh+cyZ0kNQqzF6CATVxiVhb0IcXzBFEBHHehEVAsO07cSRalBZ1bmCxhJi35HWVRFExGGEl6S0bRz7cjjlS07km4gacmGyeNpI5YKUuY0cVYnKrM6UHjgiT5VRbVwTItZxlMQpQfFISrKgFPXEkVqhMsgzBY2gxIfjDFgwgog4A35VRw2Woo5jXwGnfF0S+UZIUGJ82khFFFLThjyqGpVFnis9IIoTVFQbt4SobiQlVQQRcZQkS1A6ftpIDWqpQbLlMwUNuNqaMVADloIgItKAESUANJV9ETXNjCXyTURRM1tmg1ToXxP2rWXHaduEBw0sOWgQlDGDFXH362a0Iu7T8U90HfeXQdBvUMSdqRJfxX2iwyZFMHwZ91gRHF/HPVaEwBdyjxUhKZXc3zLfecpTCl/FO1YtDYl9+2KYKZ/QZPB1vGP701IqWUew3KTQZ1Z9dI7e3OMURJhPI7q8y+kwPj/88ntAtL7XJ4+KKinBaRxwIopsBXHixK1ac0qlbaTJaUEJTiNHVeKLTUfCN6K4VRC2TN1wNL7cdGx/GkrBZaxtWkroDmmbFSSKlrjhmJJScxk5qoZRQne4UQWXTJEWihADOg40dcOR+MLDsf2pKKV3sbapKYENpG0aSIwhdcOxlOq72FGtKIEN3KiCC0doDUWIBVWgTdxwLKEEbWx/CkoRVqRtWglZDU19EBV+NfR1/06uhlpNEGHj7AS8psvBIqAxOavAIqAxOSuhIl4lw88tD/senV/FWOTaICX+aSV6+7E+TClhXyrx+IvLQ933TfvhMCaM3u4/1ZfHdlzlra8vT+jwkbDJ1ZEgaR64IG7+DxfEK0FYEDdxxicJC+KRIhRhQTxShCYsiEeKMKQFcYNCrCUsiEeqVRHWiKNE8LIkrREbjMPAS4bJ+xI6k0r5vOSkZWiMufJS4FO/Tj2/aEuSpJbG2ZKipH69JfSNvtSkVW4kaAxplRtnNJawyh1JQBVJLZzRsBKTWZYPAWHS+QQRNIzjE70iCYgJQhAhzlwZ6dRGJPSZwuR0ZWSumhREQVEfM/i0rlhzpcWGkNRXUdK6cNDntBgNDjScFqNBGQ2nxGjiCIiWNYY0GlzWWD4ERMsTQ4KGkCcWSUDwPDEDNldLCoEhoY/K18rHXEVJCgGiqI+SshVprrSULST10VK2cNAXkhRhxIGGljqFNBpNiDDGERAmHcmQjcZiMsIyIqCKkgOGA40s8QlakQQkGSGAG2eukpMCuDjoS9TJpfmYq5T41KhY01GU1CgkDUlNSY1CwpCQLTSY72SjltConmu0oiQdIYdElaAcB5XyXgkeJPSAj2YU8r0UcgKlkDk4oyqMK6kZaCpKsErONSrxZw6erHGpwC9XCpTskTi8Nf6ExXd4JwJvQ4jazMLb4g9VjEZiRXjxOQrRJSglJ214a4Y/KPEd3mnAW3NClGsO3loQGp2FnsSfABjLGREZd2HiVOLw1vjzDt/hnQi8CYUA5+Ft8WccRiOxIrz4HIWYEpTelja8DcMfW/gO7zTgDU4JDWNuc/A2gtDoLPQk/jy+WM4wCpSEmDi8Nf70wXd4JwJvwll18/C2+BMHo5FIqJU4SyEWVB0xcXhbhj9E8B3eacDbEmo+zsLbEqo8zkNP4o/Gi+UMq0BJxInDG1bpjKetrEFle/EsK71yG781KAxqZXp2KAencIdBOTHDVxXoaK7E4VUxVC5TpvACH/wuRIQ9xe+PCqNIuWK2kqAoWOLwwuVe5Qqv+KMOwqBOtkgwhKDULNtYUBQqcXhVqMyiPOElwCepK7ZoTwJQbSGMomSKWVFyUBQoaXiJUqAyoXKFV3waYxjUyBYJihCUmWUbDYrCJA4vg8rzyRVelNDCrD3FOwhhFCFXzDJYFCRteDHUGVG5wgtwHHq4qJ8tEgQhKDHHNgxWyjRxeClsvUdGrfd4s7v3Ac1uf7Xv1zedv4ku9ohtC1bvUTBNqPfIYpIEBbjmTFjvMVKEJdR7jBRREeo9xolAFJQJ6z0yRGKj4IxQ7zFSLU6o9xgpQpDqPTJM0qPgtMKAuOFSpBp9SEU1qZgdTlFDqNEXaTSWUFctUkRFqquGGy5EnRRZEodLMFItLKSinFQ0CqeoINTCijMaQTnCI1IE7QgP5HDRjvDADZch1ZxBKmpJxVlwilaEmjNxRgMuRWIUWAQj1QnBDZfkkG1LvEr6ryO5fBhS4Bmlruzy373BbqTUlQUl6aeu7PJ6fOD3pq7s8jlUwQad1JW1kG04qSu7fKZh8PdA4spGFAkKdtekriyDbHdJXdllD0pm40GpiOMks/GglIRsK0ld2WUPSmXjQUUcS6+y8aAU6CTP1JVd9qB0Nh6UWvagdDYelAZtk0hd2YhDVLPxoPSyB2Wy8aC0gGxHSEnZi2L1uelq/0Y/8qrghfufvCj8d1loU3D3XQh3X1TP3919+fidqdMD/2Mphu/+o3B/PPnv/qNQ4301/Hi87z8KPd7Xemz06Tsrnx6IwpQFc9/9R2HM83cvebgw/sHpu/sorB6++4/Cjvf9R1GN9/1HUY33vSDpxKlB3PBZMMaDK39I3nDl77pn5nRl/BWX45X/dFfV6cp3BRN6vBKDQvLUin/nwicfstOVa9WObQ6SCn8m1nDlPwt/5NB4NbzLSd7wWfCTPD6Om7Djlf8s+GkkhrYLn5s2XlkvvRKD9OFu4RNrhmf+bsFPfTTcLXxWwPjMd5nfwD4+8/LEaYiGu4Xf0suGq8FWypPh+LuF3zo4PvPv4jeTjc98T/jNVOziYrRrj67dsb7rmtYvm3+qu8OAL6V5JatKWVnyUtqHh/8BE8wFGQ==
            const valid_range_set_1 = [
                OpenRange.from(38, 49),
                OpenRange.from(49, 60),
                OpenRange.from(206, 217),
                OpenRange.from(217, 228),
                OpenRange.from(245, 256),
            ]

            const valid_range_set_2 = [
                OpenRange.from(13, 24),
                OpenRange.from(24, 35),
                OpenRange.from(181, 192),
                OpenRange.from(192, 203),
                OpenRange.from(234, 245),
            ]

            // confirmed in game, along with the stable clock alternatives below
            const valid_range_set_3 = [
                OpenRange.from(13, 25),
                OpenRange.from(25, 36),
                OpenRange.from(181, 193),
                OpenRange.from(193, 204),
                OpenRange.from(214, 226),
            ]

            it("has correct tick ranges for input inserter transfers", () => {
                // Get the actual EntityId instances from the map keys
                const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
                // inserter id 3 is the LDS + blue chip inserter in this configuration
                const input_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(3).id)!;

                const inserter_transfers = result.transfer_history.getOrThrow(input_inserter_id)
                const sorted_transfers = [...inserter_transfers].sort((a, b) => a.tick_range.start_inclusive - b.tick_range.start_inclusive);
                const expected_ranges = valid_range_set_3

                expect(sorted_transfers.length).toBe(5);
                sorted_transfers.forEach((transfer, index) => {
                    const expected_range = expected_ranges[index];
                    expect(transfer.tick_range.start_inclusive).toBe(expected_range.start_inclusive);
                    expect(transfer.tick_range.end_inclusive).toBe(expected_range.end_inclusive);
                })
            });

            // these three alternatives were confirmed to hold full output in game
            describe("clock alternatives", () => {
                let alternatives: ClockAlternative[];
                const windowsOf = (id: string) => alternatives.find(a => a.id === id)?.result.clock_windows;

                beforeAll(() => {
                    ({ alternatives } = generateClockAlternatives(config));
                });

                it.each(["planned-belt-slack", "planned", "derived"])("%s is stable", (id) => {
                    expect(alternatives.find(a => a.id === id)?.verdict).toBe("stable");
                });

                it("batched swings for a moving belt add 4 ticks to the belt input inserters", () => {
                    expect(windowsOf("planned-belt-slack")).toEqual({
                        "inserter:2": [{ start: 1, end: 49 }, { start: 169, end: 209 }],
                        "inserter:3": [{ start: 13, end: 40 }, { start: 181, end: 208 }, { start: 214, end: 230 }],
                        "inserter:1": [{ start: 206, end: 221 }],
                    });
                });

                it("planned keeps the simulated windows", () => {
                    expect(windowsOf("planned")).toEqual({
                        "inserter:2": [{ start: 1, end: 49 }, { start: 169, end: 209 }],
                        "inserter:3": [{ start: 13, end: 36 }, { start: 181, end: 204 }, { start: 214, end: 226 }],
                        "inserter:1": [{ start: 206, end: 217 }],
                    });
                });

                it("observed windows follow each inserter's activity", () => {
                    expect(windowsOf("derived")).toEqual({
                        "inserter:2": [{ start: 1, end: 49 }, { start: 169, end: 209 }],
                        "inserter:1": [{ start: 53, end: 69 }],
                        "inserter:3": [{ start: 25, end: 41 }, { start: 53, end: 80 }, { start: 193, end: 209 }, { start: 213, end: 229 }],
                    });
                });
            });
        });
    });

    // One machine, two output hands and nine input hands per 288 ticks. Clocks for it are easy to get to the
    // expected output in one simulated period without the build actually repeating that period.
    describe("FLYING_ROBOT_FRAME clock-only check", async () => {
        const config = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME);

        // the clock alternatives of the config, generated once for the describes below, which only read them
        let alternatives: ClockAlternative[];

        beforeAll(() => {
            ({ alternatives } = generateClockAlternatives(config));
        });

        // enable ranges as the inserters see them (decider windows shifted by the circuit latency)
        const clocked = (windows: Record<number, [number, number][]>) => generateClockForConfig({
            ...config,
            inserters: config.inserters.map(inserter => ({
                ...inserter,
                overrides: {
                    enable_control: {
                        mode: "CLOCKED" as const,
                        ranges: windows[inserter.id!].map(([start, end]) => ({ start, end })),
                        period_duration_ticks: 288,
                    },
                },
            })),
        });

        describe("planned clock", () => {
            let planned: ClockAlternative;

            beforeAll(() => {
                planned = alternatives.find(a => a.id === "planned")!;
            });

            it("is stable and repeats every period", () => {
                expect(planned.verdict).toBe("stable");
                expect(planned.result.stability_check.as_built?.repeat_periods).toBe(1);
            });

            // the timelines default to this run; it differs from the planning run the windows were taken from
            it("carries the clock-only run, where both hands are dropped after the first window", () => {
                const dropsOf = (history: typeof planned.result.serializable_state_transition_history) => history.entities
                    .find(entity => entity.entity_id === "inserter:1")!.transitions
                    .filter(transition => transition.to_status === "DROP")
                    .map(transition => transition.tick);

                expect(dropsOf(planned.result.serializable_state_transition_history)).toEqual([5, 149]);
                expect(dropsOf(planned.result.clock_only_run!.state_transition_history)).toEqual([7, 19]);
                expect(planned.result.clock_only_run!.transfer_history.total_duration_ticks).toBe(288);
            });
        });

        describe("insights", () => {
            const insightsOf = (id: string) => alternatives.find(a => a.id === id)!.insights;
            const insight = (id: string, insight_id: string) => insightsOf(id).find(it => it.id === insight_id);

            it("says how much time the machine has to spare", () => {
                expect(insight("planned", "spare-time")).toMatchObject({
                    scope: "build",
                    title: "Machine 1 (flying-robot-frame) has 9 ticks to spare each clock period",
                    table: { rows: [["Machine 1 (flying-robot-frame)", "279", "9", "17.4"]] },
                });
            });

            it("lists every ingredient's insertion limit and hands per period", () => {
                expect(insight("planned", "insertion-limits")?.table?.rows).toEqual([
                    ["Machine 1 (flying-robot-frame)", "steel-plate", "1", "6", "Inserter 2", "16", "1"],
                    ["Machine 1 (flying-robot-frame)", "electric-engine-unit", "1", "6", "Inserter 2", "16", "1"],
                    ["Machine 1 (flying-robot-frame)", "electronic-circuit", "3", "18", "Inserter 3", "16", "3"],
                    ["Machine 1 (flying-robot-frame)", "battery", "2", "12", "Inserter 3", "16", "2"],
                ]);
                expect(insight("planned", "insertion-limits")?.what).toContain("takes electronic-circuit only while it holds fewer than 18");
            });

            it("says how long a full output hand takes", () => {
                expect(insight("planned", "output-hand")?.title).toBe("A full hand of flying-robot-frame takes 139.4 ticks to make");
            });

            it("points out where the exported clock swings differently than the plan", () => {
                expect(insight("planned", "plan-versus-clock")?.what)
                    .toContain("Inserter 1 drops at ticks 7, 19 where the plan had 5, 149");
            });

            it("does not compare shifted swings with the plan they were moved off", () => {
                expect(insight("shifted-swings", "plan-versus-clock")).toBeUndefined();
            });

            it("explains an unstable clock instead of reading build numbers from it", () => {
                const ids = insightsOf("swings-2").map(it => it.id);
                expect(ids).toContain("unstable");
                expect(ids).not.toContain("spare-time");
                expect(insight("swings-2", "unstable")?.what).toContain("moved 16 of 32 items in a clock period");
                expect(insight("swings-2", "insertion-limits")?.table?.rows).toHaveLength(4);
            });
        });

        describe("uneven output swings", () => {
            let uneven: ClockAlternative;

            beforeAll(() => {
                uneven = alternatives.find(a => a.id === "uneven-output")!;
            });

            it("is offered and stable from every start phase checked", () => {
                expect(uneven.verdict).toBe("stable");
                expect(uneven.result.stability_check.as_built?.start_phases_checked).toBe(112);
                expect(uneven.result.stability_check.as_built?.repeat_periods).toBe(1);
            });

            it("moves the second output swing one craft earlier and keeps the first", () => {
                expect(uneven.result.search).toMatchObject({ kind: "moved output swing", picked: { row: 2, setting: -17 } });
                expect(uneven.result.clock_windows["inserter:1"]).toEqual([{ start: 1, end: 13 }, { start: 128, end: 140 }]);
                expect(uneven.description).toContain("Output swing 2 starts 17 ticks earlier than planned.");
            });

            it("lists every position tried with whether it passed", () => {
                const candidates = uneven.result.search!.candidates;
                expect(new Set(candidates.map(it => it.row))).toEqual(new Set([2]));
                expect(candidates.filter(it => it.holds).map(it => it.setting))
                    .toEqual([-70, -52, -35, -17, 17, 35, 52, 70]);
                // 52 works since a machine at its output block crafts the ingredients that reach it, as in game
                expect(candidates.filter(it => !it.holds).map(it => it.setting))
                    .toEqual([-105, -87, 87, 105]);
            });

            it("observes the input windows again for the moved swing", () => {
                expect(uneven.result.clock_windows["inserter:3"]).toEqual([
                    { start: 13, end: 51 }, { start: 128, end: 144 }, { start: 161, end: 177 },
                ]);
            });
        });

        describe("shifted swings", () => {
            let shifted: ClockAlternative;
            let primary: ClockAlternative;

            beforeAll(() => {
                shifted = alternatives.find(a => a.id === "shifted-swings")!;
                primary = alternatives.find(a => a.id === "planned-belt-slack")!;
            });

            it("is offered and stable", () => {
                expect(shifted.verdict).toBe("stable");
                expect(shifted.result.stability_check.as_built?.repeat_periods).toBe(1);
            });

            // the smallest shift that is at least an eighth of the cycle away from the plan and whose neighbours pass too
            it("moves the second output swing and the top-up after it 25 ticks earlier as a block", () => {
                expect(shifted.result.search).toMatchObject({
                    kind: "shifted cycle",
                    picked: { row: 2, setting: -25 },
                    planned_ticks: { start: 145, end: 184 },
                    moved: [
                        { entity_id: "inserter:1", item_names: ["flying-robot-frame"] },
                        { entity_id: "inserter:3", item_names: ["battery", "electronic-circuit"] },
                    ],
                });
                expect(shifted.description).toContain("The swings planned in clock ticks 145–184 (inserter 1: flying-robot-frame; "
                    + "inserter 3: battery, electronic-circuit) start 25 ticks earlier than planned.");
                expect(shifted.result.clock_windows).toEqual({
                    "inserter:1": [{ start: 1, end: 13 }, { start: 120, end: 132 }],
                    "inserter:2": [{ start: 13, end: 40 }],
                    "inserter:3": [{ start: 13, end: 51 }, { start: 132, end: 159 }],
                });
            });

            it("lists the range of shifts that work, the planned position included", () => {
                const candidates = shifted.result.search!.candidates;
                expect(new Set(candidates.map(it => it.row))).toEqual(new Set([2]));
                const stable = candidates.filter(it => it.holds).map(it => it.setting);
                // one unbroken range, checked every 5 ticks
                expect(stable).toEqual(Array.from({ length: 23 }, (_, n) => -65 + 5 * n));
                expect(candidates.some(it => !it.holds)).toBe(true);
            });

            it("says which machine limit ends the range on each side", () => {
                expect(shifted.result.search!.earliest).toEqual({
                    setting: -65,
                    is_search_limit: false,
                    notes: ["Inserter 3 waits 9 ticks for Machine 1 (flying-robot-frame) to drop below its insertion limit for electronic-circuit"],
                });
                expect(shifted.result.search!.latest).toEqual({
                    setting: 45,
                    is_search_limit: false,
                    // full output while its output is at the block, then short of ingredients: one 9 tick stop
                    notes: ["Machine 1 (flying-robot-frame) is out of ingredients for 9 ticks until these swings arrive"],
                });
            });

            it("keeps the planned windows of the first cycle and the planned window lengths", () => {
                const lengths = (windows: typeof shifted.result.clock_windows) => Object.fromEntries(
                    Object.entries(windows).map(([key, ranges]) => [key, ranges.map(range => range.end - range.start)]));
                expect(lengths(shifted.result.clock_windows)).toEqual(lengths(primary.result.clock_windows));
                expect(shifted.inserter_window_count).toBe(primary.inserter_window_count);
            });
        });

        // built by hand and run in game: output swings 116 and 172 ticks apart
        describe("hand-made clock with unevenly spaced output swings", () => {
            let result: BlueprintGenerationResult;

            beforeAll(() => {
                result = clocked({
                    1: [[2, 15], [118, 131]],
                    2: [[15, 35]],
                    3: [[15, 45], [131, 149]],
                });
            });

            it("is stable and repeats every period", () => {
                expect(result.stability_check.holds).toBe(true);
                expect(result.stability_check.repeat_periods).toBe(1);
                expect(result.stability_check.repeat_output_items).toBeUndefined();
            });
        });

        describe("clock that reaches the expected output only every other period", () => {
            let result: BlueprintGenerationResult;

            beforeAll(() => {
                result = clocked({
                    1: [[2, 15], [59, 72]],
                    2: [[15, 35]],
                    3: [[15, 45], [201, 219]],
                });
            });

            it("moves the expected output in the simulated period", () => {
                expect(result.stability_check.actual_output_items).toBe(result.stability_check.expected_output_items);
            });

            it("is unstable because the two periods it repeats over move half of it", () => {
                expect(result.stability_check.repeat_periods).toBe(2);
                expect(result.stability_check.repeat_output_items).toBe(32);
                expect(result.stability_check.holds).toBe(false);
            });
        });
    });
});
