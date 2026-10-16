import type { Config } from 'clock-generator/browser';
import { beltQuestionOf, type BeltQuestion } from './beltQuestion';

/** Label of every button that copies the blueprint of clocks made for an earlier build */
export const STALE_COPY_LABEL = 'Copy old clock…';

/** Tooltip of the workflow bar's copy button while the clocks are for an earlier build */
export const STALE_COPY_TOOLTIP = 'Your build has changed since this clock was made. Generate again for a new one.';

/** Said in the Blueprint tab in place of the blueprint string while the clocks are for an earlier build */
export const STALE_BLUEPRINT_NOTE = 'The blueprint is hidden because your build has changed since it was made. Generate again for a new one.';

/** The button of the stale banner, which generates for the build as it is now */
export const STALE_GENERATE_AGAIN = 'Generate again';

/**
 * What a generation was for: the key of its config, the target recipe and rate the clocks were made for, the belt
 * question as the config answered it, and when the generation started (ms since the epoch)
 */
export interface GeneratedFor {
    key: string;
    recipe: string;
    itemsPerSecond: number;
    beltQuestion: BeltQuestion;
    generatedAt: number;
}

/**
 * The one definition of a config's key, for generations and validations: two configs with the same key are the
 * same build. Every edit to the form, putting a value back included, gives the key of the form as it now is.
 */
export function configKeyOf(config: Config): string {
    return JSON.stringify(config);
}

export function generatedForOf(config: Config, at: number = Date.now()): GeneratedFor {
    return {
        key: configKeyOf(config),
        recipe: config.target_output.recipe,
        itemsPerSecond: config.target_output.items_per_second,
        beltQuestion: beltQuestionOf(config),
        generatedAt: at,
    };
}

/** Whether the clocks on screen are for a build other than the one with `currentKey`. False when nothing is generated */
export function isStale(generatedFor: GeneratedFor | null, currentKey: string): boolean {
    return generatedFor !== null && generatedFor.key !== currentKey;
}

/** "{recipe} at {rate}/s", for the sentences that say what the clocks were made for; `recipeLabel` gives the recipe's game name */
export function generatedForText({ recipe, itemsPerSecond }: GeneratedFor, recipeLabel: (id: string) => string = (id) => id): string {
    return `${recipeLabel(recipe)} at ${Number(itemsPerSecond.toFixed(2)).toString()}/s`;
}

/** "made at 14:02" for clocks made today, "made on 12 Oct" for clocks made before, in the player's own format */
export function madeAtText(at: number, now: number = Date.now(), locale?: string): string {
    const made = new Date(at);
    if (made.toDateString() === new Date(now).toDateString()) {
        return `made at ${made.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
    }
    return `made on ${made.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`;
}

/**
 * "Items per second (240 → 200), Copies (1 → 2) and Inserter 3" as one list; a list that ends in "and 2 more changes"
 * (`buildChangesText`) is joined by commas only
 */
function changesList(changes: string[]): string {
    const last = changes[changes.length - 1] ?? '';
    if (changes.length <= 1 || / and \d+ more changes?$/.test(last)) {
        return changes.join(', ');
    }
    return `${changes.slice(0, -1).join(', ')} and ${last}`;
}

interface StaleTextOptions {
    /** Now, for whether the clocks were made today */
    now?: number;
    /** The recipe's game name */
    recipeLabel?: (id: string) => string;
    locale?: string;
}

/** "{recipe} at {rate}/s, made at 14:02" */
function madeForText(generatedFor: GeneratedFor, { now = Date.now(), recipeLabel = (id) => id, locale }: StaleTextOptions): string {
    return `${generatedForText(generatedFor, recipeLabel)}, ${madeAtText(generatedFor.generatedAt, now, locale)}`;
}

/**
 * The banner over Results while the clocks are for an earlier build: what they are for, when they were made, and up to
 * three of the changes since (`buildChangesText`). The banner's own button says to generate again.
 */
export function staleResultsMessage(generatedFor: GeneratedFor, changes: string[], options: StaleTextOptions = {}): string {
    const since = changes.length > 0 ? `Since then you changed ${changesList(changes)}.` : 'Your build has changed since.';
    return `These clocks are for ${madeForText(generatedFor, options)}. ${since}`;
}

/** The question before the clock of an earlier build is copied, with the same changes as the banner */
export function staleCopyMessage(generatedFor: GeneratedFor, changes: string[], options: StaleTextOptions = {}): string {
    const since = changes.length > 0 ? `Since then you changed ${changesList(changes)}, so` : 'Your build has changed since, so';
    return `This blueprint is for ${madeForText(generatedFor, options)}. ${since} this clock may not work in your build. `
        + 'Generate again to get a clock for the build you have now.';
}
