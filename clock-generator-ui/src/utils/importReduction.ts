import type { Config } from 'clock-generator/browser';

export interface ImportReduction {
    changes: { label: string; before: number; after: number }[];
    copies: number;
    target: Config['target_output'];
}

export function importReduction(before: Config, after: Config): ImportReduction {
    return {
        changes: [
            { label: 'Machines', before: before.machines.length, after: after.machines.length },
            { label: 'Inserters', before: before.inserters.length, after: after.inserters.length },
            { label: 'Belts', before: before.belts.length, after: after.belts.length },
            { label: 'Chests', before: before.chests?.length ?? 0, after: after.chests?.length ?? 0 },
            { label: 'Drills', before: before.drills?.configs.length ?? 0, after: after.drills?.configs.length ?? 0 },
            { label: 'Copies', before: before.target_output.copies, after: after.target_output.copies },
        ].filter(change => change.before !== change.after),
        copies: after.target_output.copies,
        target: after.target_output,
    };
}

