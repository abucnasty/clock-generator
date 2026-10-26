import type { InserterCoverageIssue, OutputTransferSummary } from 'clock-generator/browser';
import { isInfinityChest, type ChestFormData } from './configForm/formData';

/** A checked, rejecting direct receiver can accept the missing output by removing unfiltered items. */
export function directReceiverRemovalOptions(issues: readonly InserterCoverageIssue[], transfers: readonly OutputTransferSummary[] | null | undefined, chests: readonly ChestFormData[]) {
    const receivers = new Set<number>();
    for (const issue of issues) {
        if (issue.kind !== 'missing_output_inserter') continue;
        const transfer = transfers?.find(row => row.source.type === 'machine' && row.source.id === issue.machine_id);
        if (transfer?.status !== 'known' || transfer.mechanism !== 'result-placement' || transfer.physical_target?.type !== 'chest'
            || !transfer.results.some(result => result.item_name === issue.item_name && result.direct === 'rejected')) continue;
        receivers.add(transfer.physical_target.id);
    }
    return chests.flatMap((chest, index) => receivers.has(chest.id) && isInfinityChest(chest) && !chest.remove_unfiltered_items
        ? [{ chest, index }] : []);
}
