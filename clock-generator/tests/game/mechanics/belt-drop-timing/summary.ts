import {figuresOf, HandFigures, summarise} from "./analysis";
import {DropRecording} from "./recording";

/** The figures of every complete hand of a run's scenarios, small enough to commit beside the recordings and compare a fresh game run with */
export interface RunFigures {
    [scenario: string]: {pickups: number[]; hands: (HandFigures | null)[]};
}

export function runFigures(recording: DropRecording): RunFigures {
    const figures: RunFigures = {};
    for (const scenario of recording.info.scenarios) {
        const summary = summarise(recording, scenario.name);
        figures[scenario.name] = {pickups: summary.pickups, hands: summary.hands.map(figuresOf)};
    }
    return figures;
}
