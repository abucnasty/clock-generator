import {readControls} from "./clock-controls";

/** The clocks the values of the builds of scaffold-recordings.game.test.ts were seen on, by build name; clock-controls.test.ts checks each against the record's selected clock of the build's job */
export const scaffoldClockPins = readControls<{cases: Record<string, {config: string; backed_up_belts: boolean; clock_sha256: string; previous?: {id: string; clock_sha256: string; why: string}}>}>(
    "scaffold-recordings-clock-pins.json").cases;
