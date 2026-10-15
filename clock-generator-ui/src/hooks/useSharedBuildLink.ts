import { useCallback, useEffect, useRef, useState } from 'react';
import type { Config } from 'clock-generator/browser';
import { askEngine } from '../worker/engineClient';
import { decodeShareLink, readShareHash, shareInvalidMessage, SHARE_PROBLEM_MESSAGES, type SharedBuild } from '../utils/shareLink';
import { readConfigFile } from './usePersistedConfigForm';
import { useNotify } from './useMessages';

interface QueuedLink {
    version: string;
    data: string;
    /** A new one each time, so the same link twice is opened twice */
    id: number;
}

let nextLinkId = 0;

/** The share link in the address bar, taken out of it so a reload does not ask again; null when there is none */
function takeShareHash(): QueuedLink | null {
    const read = readShareHash(window.location.hash);
    if (read.kind === 'none') return null;
    try {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    } catch {
        // the hash stays: a reload asks again
    }
    return { version: read.version, data: read.data, id: ++nextLinkId };
}

/**
 * A share link the page was opened with, or that was put in the address bar since (`hashchange`): once the page is
 * `ready`, it is decoded and checked as a build file is, then `pending` until the player opens it (`accept`) or not
 * (`cancel`). A link that cannot be opened says why in a message, and nothing else happens. The hash is removed at
 * once, so a reload doesn't ask again and the address bar doesn't keep a build that may since have been edited.
 */
export function useSharedBuildLink(ready: boolean) {
    const notify = useNotify();
    // read while rendering, taken out of the address bar once mounted
    const [queued, setQueued] = useState<QueuedLink | null>(() => {
        const read = readShareHash(window.location.hash);
        return read.kind === 'link' ? { version: read.version, data: read.data, id: ++nextLinkId } : null;
    });
    const [pending, setPending] = useState<SharedBuild | null>(null);
    const pendingRef = useRef(pending);
    useEffect(() => {
        pendingRef.current = pending;
    }, [pending]);

    useEffect(() => {
        takeShareHash();
        const onHashChange = () => {
            const link = takeShareHash();
            if (link) setQueued(link);
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    useEffect(() => {
        if (!ready || queued === null) return;
        let alive = true;
        (async () => {
            const decoded = await decodeShareLink(queued);
            if (!alive) return;
            if (decoded.kind === 'problem') {
                notify({ severity: 'error', text: SHARE_PROBLEM_MESSAGES[decoded.problem] });
                return;
            }
            let config: Config;
            try {
                // migrated and checked as an opened build file is
                config = await askEngine({ kind: 'config-file', config: readConfigFile(JSON.stringify(decoded.config)) });
            } catch (error) {
                if (alive) notify({ severity: 'error', text: shareInvalidMessage(error instanceof Error ? error.message : String(error)) });
                return;
            }
            // a second link while one waits takes its place
            if (alive) setPending({ name: decoded.name, config });
        })().finally(() => {
            if (alive) setQueued((current) => (current?.id === queued.id ? null : current));
        });
        return () => {
            alive = false;
        };
    }, [ready, queued, notify]);

    const accept = useCallback((): SharedBuild | null => {
        const build = pendingRef.current;
        setPending(null);
        return build;
    }, []);
    const cancel = useCallback(() => setPending(null), []);

    return { pending, accept, cancel };
}
