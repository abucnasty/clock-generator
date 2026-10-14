import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeneratedFor } from '../utils/resultsStaleness';

/** How long every Copy button says "Copied" */
const COPIED_MS = 2000;

interface CopyBlueprintOptions {
    /** The selected clock's blueprint; nothing is copied without one */
    blueprintString: string | null;
    /** What to warn of when the selected clock is copied; null when nothing */
    rateWarning: string | null;
    /** What the clocks were made for, while the build has changed since: copying then asks first. Null when not */
    staleFor: GeneratedFor | null;
    /** Called once the string is on the clipboard, with the warning it was copied with */
    onCopied: (rateWarning: string | null) => void;
}

/** One copy of the blueprint, shared by every Copy button: the bar's, the card's and the string's */
interface CopyBlueprint {
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** Copies, or, for the clock of an earlier build, asks first */
    request: () => void;
    /** The question about an earlier build's clock is open */
    confirmingStale: boolean;
    /** Copies the earlier build's clock after all */
    confirm: () => void;
    cancel: () => void;
}

/**
 * The one copy of the blueprint that every Copy button uses, so that all of them say "Copied" together, the stale
 * question is asked in one dialog, and what is said after a copy is said once.
 */
export function useCopyBlueprint({ blueprintString, rateWarning, staleFor, onCopied }: CopyBlueprintOptions): CopyBlueprint {
    const [copied, setCopied] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = useCallback(async () => {
        if (!blueprintString) {
            return;
        }
        try {
            await navigator.clipboard.writeText(blueprintString);
        } catch (err) {
            console.error('Failed to copy:', err);
            return;
        }
        setCopied(true);
        onCopied(rateWarning);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    }, [blueprintString, rateWarning, onCopied]);

    const request = useCallback(() => {
        if (staleFor) {
            setConfirming(true);
        } else {
            void copy();
        }
    }, [staleFor, copy]);
    const confirm = useCallback(() => {
        setConfirming(false);
        void copy();
    }, [copy]);
    const cancel = useCallback(() => setConfirming(false), []);

    return { copied, request, confirmingStale: confirming && staleFor !== null, confirm, cancel };
}
