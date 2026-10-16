import type { Config, ConversionEntityKind, RepeatedUnitConversionPlan } from 'clock-generator/browser';
import type { ConfigFormData } from './formData';
import { formDataToConfig } from './configMapping';
import { configKeyOf } from '../resultsStaleness';

const kinds: ConversionEntityKind[] = ['machines', 'inserters', 'belts', 'chests', 'drills'];
type Row = { id?: number };
function rows(config: Config): Record<ConversionEntityKind, Row[]> {
    return { machines: config.machines, inserters: config.inserters, belts: config.belts,
        chests: config.chests ?? [], drills: config.drills?.configs ?? [] };
}
function sameRecords(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
        && sameRecords((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** Apply only the canonical source-index map, retaining actual form rows and UI identity. */
export function applyRepeatedUnitConversion(form: ConfigFormData, plan: RepeatedUnitConversionPlan): ConfigFormData | null {
    const source = formDataToConfig(form);
    if (plan.sourceConfigKey !== configKeyOf(source) || plan.copies !== plan.candidate.target_output.copies
        || plan.previousCopies !== source.target_output.copies || !Number.isInteger(plan.multiplicity) || plan.multiplicity <= 1) return null;
    const sourceRows = rows(source), candidateRows = rows(plan.candidate);
    const maps = {} as Record<ConversionEntityKind, Map<number, number>>;
    for (const kind of kinds) {
        const retained = plan.retained[kind];
        if (!Array.isArray(retained) || retained.length !== candidateRows[kind].length) return null;
        maps[kind] = new Map();
        let previousIndex = -1;
        for (const [index, entry] of retained.entries()) {
            const row = sourceRows[kind][entry.sourceIndex];
            if (!row || !Number.isInteger(entry.sourceIndex) || entry.sourceIndex <= previousIndex
                || entry.sourceId !== row.id || entry.resultId !== index + 1
                || Object.prototype.hasOwnProperty.call(entry, 'sourceId') !== Object.prototype.hasOwnProperty.call(row, 'id')) return null;
            const sourceId = row.id ?? entry.sourceIndex + 1;
            if (maps[kind].has(sourceId)) return null;
            maps[kind].set(sourceId, entry.resultId);
            previousIndex = entry.sourceIndex;
        }
    }
    const idOf = (kind: ConversionEntityKind, id: number): number => {
        const result = maps[kind].get(id);
        if (result === undefined) throw new Error('Incomplete conversion reference map');
        return result;
    };
    const endpoint = <T extends { type: 'machine' | 'belt' | 'chest'; id: number }>(end: T): T => ({
        ...end, id: idOf(end.type === 'machine' ? 'machines' : end.type === 'belt' ? 'belts' : 'chests', end.id),
    });
    try {
        const next: ConfigFormData = {
            ...form,
            target_output: { ...form.target_output, copies: plan.copies },
            machines: plan.retained.machines.map(it => ({ ...form.machines[it.sourceIndex], id: it.resultId })),
            inserters: plan.retained.inserters.map(it => {
                const row = form.inserters[it.sourceIndex];
                return { ...row, id: it.resultId, source: endpoint(row.source), sink: endpoint(row.sink) };
            }),
            belts: plan.retained.belts.map(it => ({ ...form.belts[it.sourceIndex], id: it.resultId })),
            chests: plan.retained.chests.map(it => ({ ...form.chests[it.sourceIndex], id: it.resultId })),
            ...(form.drills && { drills: { ...form.drills, configs: plan.retained.drills.map(it => {
                const row = form.drills!.configs[it.sourceIndex];
                return { ...row, id: it.resultId, target: { ...row.target, id: idOf('machines', row.target.id) } };
            }) } }),
        };
        // This verifies all candidate rows, references, globals, target and field presence as exported.
        const exported = formDataToConfig(next);
        return sameRecords(exported, plan.candidate) && configKeyOf(exported) === configKeyOf(plan.candidate) ? next : null;
    } catch {
        return null;
    }
}
