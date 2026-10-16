import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GeneratedFor } from '../utils/resultsStaleness';

/** How long every Copy button says "Copied" */
const COPIED_MS = 2000;

export interface BlueprintCopyFailure {
    blueprintString: string;
    rateWarning: string | null;
    staleFor: GeneratedFor | null;
    running: boolean;
}

interface CopyBlueprintOptions {
    blueprintString: string | null;
    rateWarning: string | null;
    staleFor: GeneratedFor | null;
    running: boolean;
    /** Opaque identity of the build, run and selected output; stable while that output is unchanged */
    copyIdentity: object | null;
    onCopied: (rateWarning: string | null, whileRunning: boolean) => void;
    /** Called only after a successful write of the current best clock */
    onPinned?: () => void;
    onCopyFailed: (failure: BlueprintCopyFailure) => void;
    /** Retires this owner's previous recovery feedback once per nonempty request, before confirmation or writing */
    onCopyAttempt?: () => void;
}

interface CopyBlueprint {
    copied: boolean;
    request: () => void;
    confirmingStale: boolean;
    confirm: () => void;
    cancel: () => void;
}

interface Attempt {
    sequence: number;
    identity: object | null;
    snapshot: BlueprintCopyFailure;
}

/** One copy operation shared by all Copy buttons, including confirmation and failed-attempt recovery. */
export function useCopyBlueprint(options: CopyBlueprintOptions): CopyBlueprint {
    const latest = useRef(options);
    useLayoutEffect(() => { latest.current = options; });
    const sequence = useRef(0);
    const confirmation = useRef<Attempt | null>(null);
    const mounted = useRef(true);
    const [copiedFor, setCopiedFor] = useState<Attempt | null>(null);
    const [confirmingFor, setConfirmingFor] = useState<Attempt | null>(null);
    if (confirmingFor && confirmingFor.identity !== options.copyIdentity) setConfirmingFor(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        mounted.current = true;
        const pendingRequests = sequence;
        return () => {
            mounted.current = false;
            pendingRequests.current++;
            clearTimeout(timer.current);
        };
    }, []);

    const copy = useCallback(async (attempt: Attempt) => {
        try {
            // A synchronous API throw or missing clipboard is the same recoverable failure as a rejected write.
            await navigator.clipboard.writeText(attempt.snapshot.blueprintString);
        } catch {
            if (mounted.current && sequence.current === attempt.sequence) {
                latest.current.onCopyFailed(attempt.snapshot);
            }
            return;
        }
        if (!mounted.current || sequence.current !== attempt.sequence || latest.current.copyIdentity !== attempt.identity) return;
        setCopiedFor(attempt);
        if (attempt.snapshot.running) latest.current.onPinned?.();
        latest.current.onCopied(attempt.snapshot.rateWarning, attempt.snapshot.running);
        timer.current = setTimeout(() => setCopiedFor(null), COPIED_MS);
    }, []);

    const request = useCallback(() => {
        const current = latest.current;
        if (!current.blueprintString) return;
        const attempt: Attempt = {
            sequence: ++sequence.current,
            identity: current.copyIdentity,
            snapshot: {
                blueprintString: current.blueprintString,
                rateWarning: current.rateWarning,
                staleFor: current.staleFor,
                running: current.running,
            },
        };
        clearTimeout(timer.current);
        setCopiedFor(null);
        setConfirmingFor(null);
        confirmation.current = null;
        current.onCopyAttempt?.();
        if (attempt.snapshot.staleFor) {
            confirmation.current = attempt;
            setConfirmingFor(attempt);
        }
        else void copy(attempt);
    }, [copy]);
    const confirm = useCallback(() => {
        const attempt = confirmation.current;
        confirmation.current = null;
        setConfirmingFor(null);
        if (attempt && attempt.sequence === sequence.current && attempt.identity === latest.current.copyIdentity) {
            void copy(attempt);
        }
    }, [copy]);
    const cancel = useCallback(() => {
        confirmation.current = null;
        setConfirmingFor(null);
    }, []);

    return {
        copied: copiedFor !== null && copiedFor.identity === options.copyIdentity,
        request,
        confirmingStale: confirmingFor !== null && confirmingFor.identity === options.copyIdentity,
        confirm,
        cancel,
    };
}
