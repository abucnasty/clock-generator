import type { ConfigFormData } from './configForm/formData';

/** Set once the player closes the intro card; read and written in try/catch, since storage can be blocked */
export const INTRO_STORAGE_KEY = 'clock-generator-intro-dismissed';

/** Nothing entered yet: no target recipe, no machine with a recipe, and no inserters, belts, chests or drills */
export function isBlankBuild(config: Pick<ConfigFormData, 'target_output' | 'machines' | 'inserters' | 'belts' | 'chests' | 'drills'>): boolean {
    return config.target_output.recipe === ''
        && config.machines.every((machine) => machine.recipe === '')
        && config.inserters.length === 0
        && config.belts.length === 0
        && config.chests.length === 0
        && config.drills === undefined;
}

/**
 * The card shows on a blank build until it is closed (remembered) or the player chose to build by hand (this visit
 * only); "Getting started" in the ⋮ menu shows it whatever the rest says.
 */
export function shouldShowIntro({ dismissed, builtByHand, forced, blank }: {
    dismissed: boolean;
    builtByHand: boolean;
    forced: boolean;
    blank: boolean;
}): boolean {
    return forced || (!dismissed && !builtByHand && blank);
}

/** Whether the card was closed in this browser; a storage that throws reads as not closed */
export function readIntroDismissed(storage: Pick<Storage, 'getItem'>): boolean {
    try {
        return storage.getItem(INTRO_STORAGE_KEY) !== null;
    } catch {
        return false;
    }
}

/** Remembers that the card was closed; a storage that throws remembers nothing (it stays closed for the visit) */
export function writeIntroDismissed(storage: Pick<Storage, 'setItem'>): void {
    try {
        storage.setItem(INTRO_STORAGE_KEY, 'true');
    } catch {
        // blocked storage: closed for this visit only
    }
}
