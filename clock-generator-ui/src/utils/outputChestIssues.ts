import type { InserterCoverageIssue } from 'clock-generator/browser';
import { isBufferChest, isContainerChest, isInfinityChest, type ChestFormData, type InserterFormData } from './configForm/formData';

export interface OutputChestIssue {
    kind: 'finite' | 'removal-disabled';
    chest: ChestFormData;
    index: number;
}

/** Output needs either a drain for finite storage or acceptance enabled on an empty infinity chest. */
export function outputChestIssues(chests: ChestFormData[], inserters: InserterFormData[]): OutputChestIssue[] {
    const receives = new Set(inserters.filter(inserter => inserter.sink.type === 'chest').map(inserter => inserter.sink.id));
    const supplies = new Set(inserters.filter(inserter => inserter.source.type === 'chest').map(inserter => inserter.source.id));
    return chests.flatMap((chest, index): OutputChestIssue[] => {
        if (!receives.has(chest.id)) return [];
        // a buffer chest, a car, a tank, a cargo wagon or a rocket silo that nothing takes from fills up
        if ((isBufferChest(chest) || isContainerChest(chest)) && !supplies.has(chest.id)) return [{ kind: 'finite', chest, index }];
        if (isInfinityChest(chest) && !chest.remove_unfiltered_items && !chest.item_filter.some(filter => filter.item_name))
            return [{ kind: 'removal-disabled', chest, index }];
        return [];
    });
}

/** The route exists: enabling removal fixes its destination without adding another inserter. */
export function coverageHandledByChestIssue(issue: InserterCoverageIssue, warnings: OutputChestIssue[], inserters: InserterFormData[]): boolean {
    return issue.kind === 'missing_output_inserter' && warnings.some(warning => warning.kind === 'removal-disabled'
        && inserters.some(inserter => inserter.source.type === 'machine' && inserter.source.id === issue.machine_id
            && inserter.sink.type === 'chest' && inserter.sink.id === warning.chest.id
            && (!inserter.filters?.length || inserter.filters.includes(issue.item_name))));
}

export function outputChestIssueTitle({ kind, chest }: OutputChestIssue): string {
    return kind === 'finite' ? `Chest ${chest.id} can fill up and block output` : `Chest ${chest.id} needs output removal enabled`;
}

export const outputChestIssueElementId = (id: number) => `output-chest-issue-${id}`;
