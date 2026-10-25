import type { Config } from './schema';
import { deriveOutputTransfers } from './output-transfer';
import { Entity, type ReadableEntityRegistry } from '../entities';

export interface OutputTransferGenerationIssue {
    code: 'no-accepted-results' | 'multiple-accepted-results';
    machine_id: number;
    target_machine_id: number;
    accepted_items: string[];
    message: string;
}

function issueFor(machine_id: number, target_machine_id: number, accepted_items: string[]): OutputTransferGenerationIssue | undefined {
    if (accepted_items.length === 1) return undefined;
    const code = accepted_items.length === 0 ? 'no-accepted-results' : 'multiple-accepted-results';
    const message = code === 'no-accepted-results'
        ? `Machine ${target_machine_id} takes none of Machine ${machine_id}'s results. A clock for this physical target is not planned yet.`
        : `Machine ${machine_id} places several results into Machine ${target_machine_id}. A clock for a machine that takes more than one of those results is not planned yet.`;
    return { code, machine_id, target_machine_id, accepted_items, message };
}

/** Saved physical layouts may express these cases; generation and demand previews must still refuse them. */
export function outputTransferGenerationIssues(config: Config): OutputTransferGenerationIssue[] {
    return deriveOutputTransfers(config).flatMap(summary => {
        if (summary.source.type !== 'machine' || summary.physical_target?.type !== 'machine' || summary.results.length === 0 || summary.results.some(result => result.direct === 'unknown')) return [];
        const issue = issueFor(summary.source.id, summary.physical_target.id,
            summary.results.filter(result => result.direct === 'accepted').map(result => result.item_name));
        return issue === undefined ? [] : [issue];
    });
}

export function assertOutputTransferGenerationSupported(config: Config): void {
    const issue = outputTransferGenerationIssues(config)[0];
    if (issue) throw new Error(issue.message);
}

/** The same refusal for public arithmetic entry points accepting a registry instead of a config. */
export function assertMachineResultTargetsSupported(registry: Pick<ReadableEntityRegistry, 'getAll'>): void {
    const machines = registry.getAll().filter(Entity.isMachine);
    for (const machine of machines) {
        const target = machines.find(target => target.entity_id.id === machine.result_target?.id);
        if (!target) continue;
        const issue = issueFor(machine.entity_id.number, target.entity_id.number,
            machine.outputs.filter(output => target.inputs.has(output.item_name)).map(output => output.item_name));
        if (issue) throw new Error(issue.message);
    }
}
