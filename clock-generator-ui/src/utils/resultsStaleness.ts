import type { Config } from 'clock-generator/browser';
import { beltQuestionOf, type BeltQuestion } from './beltQuestion';

/** Label of every button that copies the blueprint of clocks made for an earlier build */
export const STALE_COPY_LABEL = 'Copy old clock…';

/** Tooltip of the workflow bar's copy button while the clocks are for an earlier build */
export const STALE_COPY_TOOLTIP = 'Your build has changed since this clock was made. Generate again for a new one.';

/** Said in the Blueprint tab in place of the blueprint string while the clocks are for an earlier build */
export const STALE_BLUEPRINT_NOTE = 'The blueprint is hidden because your build has changed since it was made. Generate again for a new one.';

/**
 * What a generation was for: the key of its config, the target recipe and rate the clocks were made for, and the belt
 * question as the config answered it
 */
export interface GeneratedFor {
    key: string;
    recipe: string;
    itemsPerSecond: number;
    beltQuestion: BeltQuestion;
}

/**
 * The one definition of a config's key, for generations and validations: two configs with the same key are the
 * same build. Every edit to the form, putting a value back included, gives the key of the form as it now is.
 */
export function configKeyOf(config: Config): string {
    return JSON.stringify(config);
}

export function generatedForOf(config: Config): GeneratedFor {
    return {
        key: configKeyOf(config),
        recipe: config.target_output.recipe,
        itemsPerSecond: config.target_output.items_per_second,
        beltQuestion: beltQuestionOf(config),
    };
}

/** Whether the clocks on screen are for a build other than the one with `currentKey`. False when nothing is generated */
export function isStale(generatedFor: GeneratedFor | null, currentKey: string): boolean {
    return generatedFor !== null && generatedFor.key !== currentKey;
}

/** "{recipe} at {rate}/s", for the sentences that say what the clocks were made for */
export function generatedForText({ recipe, itemsPerSecond }: GeneratedFor): string {
    return `${recipe} at ${Number(itemsPerSecond.toFixed(2)).toString()}/s`;
}

/** The banner over Results while the clocks are for an earlier build */
export function staleResultsMessage(generatedFor: GeneratedFor): string {
    return `These clocks are for ${generatedForText(generatedFor)}. Your build has changed since. Generate again.`;
}
