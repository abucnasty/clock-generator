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
            + "They would also fit with the copies 16, 18, 20, 22 or 24 tiles apart, and at any of these plus 14."
            + " This assumes every copy drops onto the belt the way this one does.");
    });

    it("says the hands land on each other with the copies 13 tiles apart, and what would fit", async () => {
        expect(dropRoomNote(await grenade(at(13)))).toBe(`${LEAD} land on each other on belt 1, if the inserters of a copy start together, and some of them wait for room. `
            + "They would fit with the copies 12, 16, 18, 20, 22 or 24 tiles apart, or 13 tiles apart with the inserters of a copy 7 tiles apart, and at any of these plus 14."
            + " This assumes every copy drops onto the belt the way this one does.");
    });

    it("lists spacings only, where no distance between a copy's inserters helps", async () => {
        expect(dropRoomNote(await grenade(at(14)))).toBe(`${LEAD} land on each other on belt 1, if the inserters of a copy start together, and some of them wait for room. `
            + "They would fit with the copies 12, 16, 18, 20, 22 or 24 tiles apart, and at any of these plus 14."
            + " This assumes every copy drops onto the belt the way this one does.");
    });

    it("lists the same spacings whatever spacing is typed, and leaves out the one the typed spacing stands for", async () => {
        for (const x of [26, 40]) expect(dropRoomNote(await grenade(at(x)))).toBe(dropRoomNote(await grenade()));
        expect(dropRoomNote(await grenade(at(27)))).toBe(dropRoomNote(await grenade(at(13)))!.replace("13 tiles apart", "27 tiles apart"));
    });

    it("says why no spacing fits when the hands of the copies outnumber the tiles the belt moves in a period: automation science, 240 a second, 9 copies", async () => {
        const science = async (change?: (config: Config) => void): Promise<Config> => {
            const config = structuredClone(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE));
            config.machines[0].position = { x: 0, y: 0 };
            Object.assign(config.inserters[1], { position: { x: 0, y: 3 }, direction: 8 });
            (config.inserters[1].sink as { belt_direction?: number }).belt_direction = 12;
            config.target_output.copy_offset = { x: 5, y: 0 };
            change?.(config);
            return config;
        };
        const text = "At about 36 ticks a period, the belt moves 4.5 tiles a period, but the 9 copies drop 9 hands on it, so no spacing of the copies fits: some hands always wait for room. This assumes every copy drops onto the belt the way this one does.";
        expect(estimatedPeriod(await science())).toBe(36);
        expect(dropRoomNote(await science())).toBe(text);
        // whatever spacing is typed
        expect(dropRoomNote(await science(it => { it.target_output.copy_offset = { x: 12, y: 0 }; }))).toBe(text);
        // at a quarter of the rate the period is 144 ticks and the belt moves 18 tiles in it: the 9 hands have room, and the scan is made
        const slow = dropRoomNote(await science(it => { it.target_output.items_per_second = 60; }))!;
        expect(slow).toMatch(/^At about 144 ticks a period \(estimated/);
        expect(slow).not.toMatch(/always wait/);
    });

    it("judges only the drops it checks: hands of side-loaded drops are not counted, and what is left out is named", async () => {
        const mark = (...ids: number[]) => (config: Config) => config.inserters.forEach((inserter, index) => {
            if (ids.includes(inserter.id ?? index + 1) && inserter.sink.type === "belt") inserter.sink.drop_capture = { status: "side-loaded", tiles: 3 };
        });
        const UNCHECKED = "Drops that are side-loaded or go through a splitter are not checked here.";
        // inserters 2 and 8 side-load: 7 hands of inserters 1 and 7 each on 14 tiles fit at 12, and at 13 as well, where the pair no longer collides
        expect(dropRoomNote(await grenade(mark(2, 8)))).toMatch(/fit between each other on belt 1, if the inserters of a copy start together\./);
        expect(dropRoomNote(await grenade(mark(2, 8)))!.endsWith(` This assumes every copy drops onto the belt the way this one does. ${UNCHECKED}`)).toBe(true);
        expect(dropRoomNote(await grenade())).not.toContain(UNCHECKED);
        // all marked: the note says only what is not covered
        expect(dropRoomNote(await grenade(mark(1, 2, 7, 8)))).toBe(UNCHECKED);
    });

    it("counts only the hands of the drops it checks: at 480 a second the belt moves 7 tiles, and 14 hands do not fit while the 7 that are not side-loaded do", async () => {
        const mark = (...ids: number[]) => (config: Config) => {
            // the machines twice as fast, so that the build can make 480 a second: the at-target rates refuse a rate it cannot
            config.target_output.items_per_second = 480;
            config.machines.forEach(machine => { machine.crafting_speed = machine.crafting_speed! * 2; });
            config.inserters.forEach((inserter, index) => {
                if (ids.includes(inserter.id ?? index + 1) && inserter.sink.type === "belt") inserter.sink.drop_capture = { status: "side-loaded", tiles: 3 };
            });
        };
        expect(dropRoomNote(await grenade(mark()))).toBe("At about 56 ticks a period, the belt moves 7 tiles a period, but the 7 copies drop 14 hands on it, so no spacing of the copies fits: some hands always wait for room. This assumes every copy drops onto the belt the way this one does.");
        const left = dropRoomNote(await grenade(mark(2, 8)))!;
        expect(left).toMatch(/^At about 56 ticks a period \(estimated from the target rate/);
        expect(left).not.toContain("always wait");
        expect(left.endsWith(" This assumes every copy drops onto the belt the way this one does. Drops that are side-loaded or go through a splitter are not checked here.")).toBe(true);
    });

    it("says the period cannot be estimated, and nothing where the copies' gap is not given or the copies share no belt", async () => {
        expect(dropRoomNote(await grenade(it => { it.inserters.push({ ...structuredClone(it.inserters[0]), id: 9 }); }))).toBe(DROP_ROOM_NOT_ESTIMATED);
        expect(dropRoomNote(await grenade(it => { delete it.target_output.copy_offset; }))).toBeNull();
        expect(dropRoomNote(await grenade(it => { it.target_output.copies = 1; }))).toBeNull();
        expect(dropRoomNote(await grenade(it => { it.target_output.copy_offset = { x: 0, y: 40 }; }))).toBeNull();
        expect(dropRoomNote(await grenade(it => { delete it.inserters[7].position; }))).toBeNull();
    });
});
