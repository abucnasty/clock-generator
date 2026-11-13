import type { SuggestedTarget } from 'clock-generator/browser';
import { formatNumberText } from './numberText';
import { nameInSentence } from './entityLabel';

/** A target output, as the form and the export hold it */
export interface TargetValues {
    recipe: string;
    items_per_second: number;
    copies: number;
    /** Where the next copy stands; the export states it where the selection shows copies at one spacing */
    copy_offset?: { x: number; y: number };
}

/** Decimals the target a paste fills in keeps */
const TARGET_DECIMALS = 3;

/**
 * The target a paste fills in: the suggestion's rate floored to 3 decimals. The suggestion is the most the machines
 * make, so it is never rounded up past it, and float noise from the mod (1.8000000000000003) goes. The gap to the next
 * copy comes with it where the export states one.
 */
export function targetToFill(suggestion: SuggestedTarget): TargetValues {
    const scale = 10 ** TARGET_DECIMALS;
    const max = suggestion.target.items_per_second;
    // the small nudge keeps a value such as 1.8 (1.7999999…98 when scaled) from flooring a step too low; a nudge that
    // lands above the true maximum (22.9689999…) takes the step back, so the target never asks for more than it
    const nudged = Math.floor(max * scale + 1e-6) / scale;
    const floored = nudged > max ? nudged - 1 / scale : nudged;
    const { recipe, copies, copy_offset } = suggestion.target;
    return { recipe, items_per_second: Math.round(floored * scale) / scale, copies,
        ...(copy_offset !== undefined && { copy_offset: { x: copy_offset.x, y: copy_offset.y } }) };
}

/** "1 copy", "3 copies" */
const copiesText = (copies: number) => `${copies} ${copies === 1 ? 'copy' : 'copies'}`;

/**
 * The Target Output row of the paste's confirm dialog, with the recipe's name given by `name`: "Target Output: Logistic
 * science pack, up to 22.968/s, 1 copy"
 */
export function targetRowLabel(target: TargetValues, name: (id: string) => string): string {
    return `Setpoint: ${name(target.recipe)}, up to ${formatNumberText(target.items_per_second, { maxDecimals: TARGET_DECIMALS })}/s, ${copiesText(target.copies)}`;
}

/** Where the suggestion came from, and that it is a ceiling */
export function targetRowCaption(source: SuggestedTarget['source']): string {
    return source === 'mod'
        ? 'From the Factorio export. This is the maximum output; you can lower the rate after importing.'
        : 'Estimated maximum output of the imported machines. You can lower the rate in the Setpoint panel after importing.';
}

/**
 * Said under the row when the target it fills is the export's suggested maximum: a clock at the machines' maximum has no
 * room to go back to its rate after a supply stop or an output blockage. Null for an estimate of the imported machines, which says it is one.
 */
export function maximumTargetNote(source: SuggestedTarget['source']): string | null {
    return source === 'mod' ? 'At the maximum the clock has no room to go back to its rate after a supply stop or an output blockage; lower the rate for headroom.' : null;
}

/** Said under the row when Target Output is already set, so the row starts unticked */
export function replacesTargetNote(current: TargetValues, name: (id: string) => string): string {
    return `Tick to replace your current target (${nameInSentence(name(current.recipe))} at ${formatNumberText(current.items_per_second)}/s).`;
}

export const NO_TARGET_NOTE = 'Could not tell what the build makes. Set the setpoint after importing.';
