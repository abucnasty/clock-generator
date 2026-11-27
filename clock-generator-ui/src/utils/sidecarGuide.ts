/**
 * The words of the way in: the intro card, the Paste from Factorio dialog and the mod link. In one place, so the copy
 * changes together (the glossary in the README: build, blueprint; never "config" in a sentence).
 */

export const INTRO_HEADING = 'Make a clock for your build';
export const INTRO_SENTENCE =
    'This tool makes a circuit clock that switches your inserters and mining drills on only when they have work, so your build holds the rate you want with fewer inserter wakeups.';
export const INTRO_STEPS = {
    generate: 'Click Generate. The tool checks your build and makes the clocks.',
    copy: 'Copy the blueprint, put it in Factorio, and wire the clock to your inserters.',
} as const;
export const INTRO_BUTTONS = {
    paste: 'Paste from Factorio',
    example: 'Try an example',
    byHand: 'Build by hand',
    guide: 'How to export with the Sidecar mod',
    hide: 'Hide this introduction',
} as const;

export interface PastePrompt {
    severity: 'info' | 'warning' | 'error';
    text: string;
}

/** Why the clipboard gave nothing to read */
type ClipboardProblem = 'unreadable';

/** Why a paste of JSON is not read: nothing in it, not JSON, or a build file (opened with Open configuration file) */
type PasteProblem = 'empty' | 'not-json' | 'build-file';

/** What the Paste from Factorio dialog says when the clipboard could not be used, one line per reason */
export const PASTE_PROMPTS: Record<PasteProblem | ClipboardProblem, PastePrompt> = {
    unreadable: {
        severity: 'info',
        text: 'Your browser did not let this page read the clipboard. Copy the export in Factorio as below, then paste it into the box.',
    },
    empty: { severity: 'info', text: 'Nothing to paste: your clipboard is empty.' },
    'not-json': { severity: 'warning', text: 'Your clipboard does not hold a build from the Clock Generator Sidecar mod.' },
    'build-file': {
        severity: 'warning',
        text: 'That is a configuration file, not an export from the mod. To open it, use Open configuration file… in the ⋮ menu.',
    },
};

/** A sentence ends with a full stop, so the next one can follow it */
const asSentence = (text: string) => {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

export const PASTE_DIALOG = {
    title: 'Paste from Factorio',
    boxStep: 'Paste it into the box below.',
    boxLabel: 'Paste the export here',
    continue: 'Continue',
    cancel: 'Cancel',
} as const;

/** A file that was opened but is not a build file this site can read; never the parser's own words */
export function openFileProblem(error: unknown): string {
    if (error instanceof SyntaxError) {
        return 'Could not open that file: it is not a configuration file (it does not hold JSON).';
    }
    const reason = error instanceof Error && error.message ? asSentence(error.message) : 'it is not a configuration file this site can read.';
    return `Could not open that file: ${reason}`;
}
