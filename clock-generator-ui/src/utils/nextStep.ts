/**
 * Which button is the one filled (green, or yellow when the clock warns) next step: Generate, the bar's Copy blueprint,
 * or the Copy blueprint of the Results summary card. Every other button of the bar and the card is outlined or text.
 */
export type NextStep = 'generate' | 'copy-bar' | 'copy-page';

export interface NextStepInput {
    /** How many problems keep the build from being clocked (`problemsOf`) */
    problemCount: number;
    /** A generation runs */
    isRunning: boolean;
    /** A blueprint has been generated */
    hasBlueprint: boolean;
    /** The build has changed since the clocks on screen were made */
    stale: boolean;
    view: 'configure' | 'results';
    /** The Results summary card, with its own Copy blueprint, is on the page */
    pageHasCopy: boolean;
}

/**
 * Generate while it runs or the build has problems (it is then off, or goes to the problem), before any clock and once
 * the build has changed since; otherwise the copy of the clock: the card's on Results, the bar's anywhere else
 */
export function nextStepOf(input: NextStepInput): NextStep {
    if (input.isRunning || input.problemCount > 0) {
        return 'generate';
    }
    if (input.hasBlueprint && !input.stale) {
        return input.view === 'results' && input.pageHasCopy ? 'copy-page' : 'copy-bar';
    }
    return 'generate';
}
