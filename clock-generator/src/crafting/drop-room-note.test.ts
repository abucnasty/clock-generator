import { describe, expect, it } from "vitest";
import { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { DROP_ROOM_NOT_ESTIMATED, dropRoomNote, estimatedPeriod } from "./drop-room-note";

const grenade = async (change?: (config: Config) => void): Promise<Config> => {
    const config = structuredClone(await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE));
    change?.(config);
    return config;
};
const at = (x: number) => (config: Config) => { config.target_output.copy_offset = { x, y: 0 }; };
const LEAD = "At about 112 ticks a period (estimated from the target rate: one output hand at the machine's rate), the hands of the 7 copies";

describe("the period estimated from the settings", () => {
    it("is the ticks one output hand takes at the target rate: 16 grenades at 240 a second over 7 copies of 4 machines", async () => {
        expect(estimatedPeriod(await grenade())).toBe(112);
    });

    it("is multiplied by the cycles the config sets, and taken down to whole ticks", async () => {
        expect(estimatedPeriod(await grenade(it => { it.overrides = { ...it.overrides, lcm: 3 }; }))).toBe(336);
        // 16 / (239 / 28) = 112.33 ticks
        expect(estimatedPeriod(await grenade(it => { it.target_output.items_per_second = 239; }))).toBe(112);
    });

    it("is none when an output machine has two inserters taking its product out, or the settings are refused", async () => {
        expect(estimatedPeriod(await grenade(it => { it.inserters.push({ ...structuredClone(it.inserters[0]), id: 9 }); }))).toBeNull();
        expect(estimatedPeriod(await grenade(it => { it.target_output.items_per_second = 0; }))).toBeNull();
    });
});

describe("the note under the gap between copies", () => {
    it("says the hands fit, and the other spacings that would, with the copies 12 tiles apart", async () => {
        expect(dropRoomNote(await grenade())).toBe(`${LEAD} fit between each other on belt 1, if the inserters of a copy start together. `
            + "They would also fit with the copies 16, 18, 20, 22 or 24 tiles apart.");
    });

    it("says the hands land on each other with the copies 13 tiles apart, and what would fit", async () => {
        expect(dropRoomNote(await grenade(at(13)))).toBe(`${LEAD} land on each other on belt 1, if the inserters of a copy start together, and some of them wait for room. `
            + "They would fit with the copies 12, 16, 18, 20, 22, 24 or 26 tiles apart, or 13 tiles apart with the inserters of a copy 7 tiles apart.");
    });

    it("lists spacings only, where no distance between a copy's inserters helps", async () => {
        expect(dropRoomNote(await grenade(at(14)))).toBe(`${LEAD} land on each other on belt 1, if the inserters of a copy start together, and some of them wait for room. `
            + "They would fit with the copies 12, 16, 18, 20, 22, 24 or 26 tiles apart.");
    });

    it("says the period cannot be estimated, and nothing where the copies' gap is not given or the copies share no belt", async () => {
        expect(dropRoomNote(await grenade(it => { it.inserters.push({ ...structuredClone(it.inserters[0]), id: 9 }); }))).toBe(DROP_ROOM_NOT_ESTIMATED);
        expect(dropRoomNote(await grenade(it => { delete it.target_output.copy_offset; }))).toBeNull();
        expect(dropRoomNote(await grenade(it => { it.target_output.copies = 1; }))).toBeNull();
        expect(dropRoomNote(await grenade(it => { it.target_output.copy_offset = { x: 0, y: 40 }; }))).toBeNull();
        expect(dropRoomNote(await grenade(it => { delete it.inserters[7].position; }))).toBeNull();
    });
});
