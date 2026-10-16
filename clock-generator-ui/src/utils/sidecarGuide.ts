import type { SidecarExportProblem } from './sidecarExport';

/**
 * The words of the way in: the intro card, the Paste from Factorio dialog and the mod link. In one place, so the copy
 * changes together (the glossary in the README: build, blueprint; never "config" in a sentence).
 */

/** The mod's page on the Factorio mod portal (checked 2026-10-14: release 0.7.0, for Factorio 2.1) */
export const SIDECAR_MOD_URL = 'https://mods.factorio.com/mod/clock-generator-sidecar';
export const SIDECAR_MOD_NAME = 'Clock Generator Sidecar';
export const SIDECAR_NEEDS = 'Needs Factorio 2.1.';
/** Said after a link that opens in a new tab */
export const NEW_TAB_CUE = '(opens in a new tab)';

/** How to copy a build in Factorio with the mod, as the mod's portal page says it */
export const SIDECAR_COPY_STEPS = [
    "In Factorio, press Alt+E to pick up the Sidecar mod's selection tool.",
    'Drag a box over the machines, inserters, belts and chests of one unit of your build. For repeated identical units, select just one and set Copies here.',
    'Click Copy JSON.',
    'Press Ctrl+C.',
] as const;

export const INTRO_HEADING = 'Make a clock for your build';
export const INTRO_SENTENCE =
    'This tool makes a circuit clock that switches your inserters on only when they have work, so your build holds the rate you want with fewer inserter wake-ups.';
export const INTRO_STEPS = {
    getBuildIn: 'Get your build in. With the Sidecar mod:',
    getBuildInLast: 'Then click Paste from Factorio here.',
    generate: 'Click Generate. The tool checks your build and makes the clocks.',
    copy: 'Copy the blueprint, place it in Factorio, and wire the clock to your inserters.',
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

/** What the Paste from Factorio dialog says when the clipboard could not be used, one line per reason */
export const PASTE_PROMPTS: Record<SidecarExportProblem | ClipboardProblem, PastePrompt> = {
    unreadable: {
        severity: 'info',
        text: 'Your browser did not let this page read the clipboard. Copy the export in Factorio as below, then paste it into the box.',
    },
    empty: { severity: 'info', text: 'Nothing to paste: your clipboard is empty.' },
    'not-json': { severity: 'warning', text: 'Your clipboard does not hold a build from the Clock Generator Sidecar mod.' },
    'not-an-export': { severity: 'warning', text: 'Your clipboard does not hold a build from the Clock Generator Sidecar mod.' },
    'build-file': {
        severity: 'warning',
        text: 'That is a build file, not an export from the mod. To open it, use Open build file… in the ⋮ menu.',
    },
    'no-entities': {
        severity: 'warning',
        text: 'The export has no machines, inserters, belts or chests. Drag a box over one complete unit of the build in Factorio, then click Copy JSON again.',
    },
};

/** The mod's export, said once in the Paste from Factorio dialog: the word the prompts use */
export const EXPORT_DEFINITION = 'it copies the build as text, its export.';

/** A sentence ends with a full stop, so the next one can follow it */
const asSentence = (text: string) => {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * The export was read but an entry in it is not one the generator can use. The engine's message ("Invalid machine at
 * index 0: …") gives the kind and the place; the player sees those, numbered from 1, and never the schema's own words.
 */
export function invalidExportPrompt(message: string): PastePrompt {
    const where = /^Invalid (machine|drill|inserter|belt|chest) at index (\d+)/.exec(message);
    const problem = where ? `The export has a problem with ${where[1]} ${Number(where[2]) + 1}.` : 'The export has a problem.';
    return {
        severity: 'error',
        text: `${problem} Copy it again from Factorio. If it keeps happening, update the Sidecar mod.`,
    };
}

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
        return 'Could not open that file: it is not a build file (it does not hold JSON).';
    }
    const reason = error instanceof Error && error.message ? asSentence(error.message) : 'it is not a build file this site can read.';
    return `Could not open that file: ${reason}`;
}
