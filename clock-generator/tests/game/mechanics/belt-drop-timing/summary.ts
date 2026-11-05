import {figuresOf, handsOf, HandFigures, summarise} from "./analysis";
import {DropRecording, TrimmedRecording} from "./recording";

/** The figures of every complete hand of a run's scenarios, small enough to compare a fresh game run with the kept recording */
export interface RunFigures {
    [scenario: string]: {pickups: number[]; hands: (HandFigures | null)[]};
}

export function runFigures(recording: TrimmedRecording): RunFigures {
    const figures: RunFigures = {};
    for (const scenario of recording.info.scenarios) {
        const summary = summarise(recording, scenario.name);
        figures[scenario.name] = {pickups: summary.pickups, hands: summary.hands.map(figuresOf)};
    }
    return figures;
}

/** What a recording keeps of a full one: the hands and their stacks of every scenario, and the few facts of the run the checks read */
export function trimRecording(full: DropRecording): TrimmedRecording {
    return {
        info: {
            scenarios: full.info.scenarios.map(({name, flows, pickup, drop_target, allow_custom_vectors, drop}) =>
                ({name, flows, pickup, drop_target, allow_custom_vectors, drop: {u: drop.u}})),
            force: {belt_stack_size_bonus: full.info.force.belt_stack_size_bonus},
            research_unchanged: full.info.research_unchanged,
            factorio: full.info.factorio,
        },
        scenarios: Object.fromEntries(full.info.scenarios.map(scenario =>
            [scenario.name, {rows: full.runs[scenario.name].length, hands: handsOf(full, scenario.name)}])),
    };
}
