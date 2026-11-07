import type { Config } from 'clock-generator/browser';

export interface ImportReduction {
    changes: { label: string; before: number; after: number }[];
    copies: number;
    target: Config['setpoint'];
}

export function importReduction(before: Config, after: Config): ImportReduction {
    return {
        changes: [
            { label: 'Machines', before: before.machines.length, after: after.machines.length },
            { label: 'Inserters', before: before.inserters.length, after: after.inserters.length },
            { label: 'Belts', before: before.belts.length, after: after.belts.length },
            { label: 'Chests', before: before.chests?.length ?? 0, after: after.chests?.length ?? 0 },
            { label: 'Drills', before: before.drills?.configs.length ?? 0, after: after.drills?.configs.length ?? 0 },
            { label: 'Copies', before: before.setpoint.copies, after: after.setpoint.copies },
        ].filter(change => change.before !== change.after),
        copies: after.setpoint.copies,
        target: after.setpoint,
    };
}

