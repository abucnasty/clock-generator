import type { SuggestedTarget } from 'clock-generator/browser';
import { formatNumberText } from './numberText';

/** A target output, as the form and the export hold it */
export interface TargetValues {
    recipe: string;
    items_per_second: number;
    copies: number;
}

/** Decimals the target a paste fills in keeps */
const TARGET_DECIMALS = 3;

/**
 * The target a paste fills in: the suggestion's rate floored to 3 decimals. The suggestion is the most the machines
 * make, so it is never rounded up past it, and float noise from the mod (1.8000000000000003) goes.
 */
export function targetToFill(suggestion: SuggestedTarget): TargetValues {
    const scale = 10 ** TARGET_DECIMALS;
    // the small nudge keeps a value such as 1.8 (1.7999999…98 when scaled) from flooring a step too low
    const floored = Math.floor(suggestion.target.items_per_second * scale + 1e-6) / scale;
    return { recipe: suggestion.target.recipe, items_per_second: floored, copies: suggestion.target.copies };
}

/** "1 copy", "3 copies" */
const copiesText = (copies: number) => `${copies} ${copies === 1 ? 'copy' : 'copies'}`;

/** The Target Output row of the paste's confirm dialog: "Target Output: logistic-science-pack at up to 22.968/s, 1 copy" */
export function targetRowLabel(target: TargetValues): string {
    return `Target Output: ${target.recipe} at up to ${formatNumberText(target.items_per_second, { maxDecimals: TARGET_DECIMALS })}/s, ${copiesText(target.copies)}`;
}

/** Where the suggestion came from, and that it is a ceiling */
export function targetRowCaption(source: SuggestedTarget['source']): string {
    const from = source === 'mod'
        ? "From the mod's export"
        : 'Worked out from your machines: the item they make that nothing else in the paste uses';
    return `${from}. It is the most the machines make at full speed; lower it to what you need in Target Output after importing.`;
}

/** Said under the row when Target Output is already set, so the row starts unticked */
export function replacesTargetNote(current: TargetValues): string {
    return `This replaces your current target (${current.recipe} at ${formatNumberText(current.items_per_second)}/s).`;
}

export const NO_TARGET_NOTE = 'Could not tell what the build makes. Set Target Output after importing.';
