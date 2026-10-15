import type { DebugSteps } from 'clock-generator/browser';

/** Where the ⋮ > Developer tools setting is kept between visits */
const DEVELOPER_TOOLS_KEY = 'clock-generator-developer-tools';

/** What a generation runs with while the tools, and so their switches, are off */
export const NO_DEBUG_STEPS: DebugSteps = { prepare: false, warm_up: false, simulate: false };

/**
 * Whether the page opens with Developer tools on: a `debug` parameter in the address (`?debug`, `?foo=1&debug`) turns
 * them on whatever was kept; otherwise the setting kept from the last visit (`stored`, the text in storage) does.
 */
export function developerToolsInitial(search: string, stored: string | null): boolean {
    let asked = false;
    try {
        asked = new URLSearchParams(search).has('debug');
    } catch {
        // an address the browser cannot read leaves the setting as it was kept
    }
    return asked || stored === 'true';
}

/** The setting kept from the last visit; null when there is none or storage cannot be read */
export function readDeveloperTools(): string | null {
    try {
        return window.localStorage.getItem(DEVELOPER_TOOLS_KEY);
    } catch {
        return null;
    }
}

/** Keeps the setting for the next visit; the page works without it */
export function writeDeveloperTools(on: boolean): void {
    try {
        if (on) {
            window.localStorage.setItem(DEVELOPER_TOOLS_KEY, 'true');
        } else {
            window.localStorage.removeItem(DEVELOPER_TOOLS_KEY);
        }
    } catch {
        // storage is off: the tools stay as they are for this visit
    }
}
