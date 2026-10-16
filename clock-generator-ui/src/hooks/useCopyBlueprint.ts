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
    // what was copied, and for which earlier build the question is open: another clock is not "Copied", and a question
    // asked about clocks that have since become current (or been made again) is not open any more
    const [copiedFor, setCopiedFor] = useState<{ blueprint: string; staleFor: GeneratedFor | null } | null>(null);
    const [confirmingFor, setConfirmingFor] = useState<GeneratedFor | null>(null);
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
        setCopiedFor({ blueprint: blueprintString, staleFor });
        onCopied(rateWarning);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedFor(null), COPIED_MS);
    }, [blueprintString, staleFor, rateWarning, onCopied]);

    const request = useCallback(() => {
        if (staleFor) {
            setConfirmingFor(staleFor);
        } else {
            void copy();
        }
    }, [staleFor, copy]);
    const confirm = useCallback(() => {
        setConfirmingFor(null);
        void copy();
    }, [copy]);
    const cancel = useCallback(() => setConfirmingFor(null), []);

    return {
        // an edit that puts the clocks out of date ends "Copied" too: the string is the same, but it is an old clock now
        copied: copiedFor !== null && copiedFor.blueprint === blueprintString && copiedFor.staleFor === staleFor,
        request,
        confirmingStale: confirmingFor !== null && confirmingFor === staleFor,
        confirm,
        cancel,
    };
}
