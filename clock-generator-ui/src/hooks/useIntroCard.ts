import { useCallback, useState } from 'react';
import { readIntroDismissed, shouldShowIntro, writeIntroDismissed } from '../utils/introCard';

/** The page's storage, reached only inside the calls: in some browsers merely reading `localStorage` throws */
const pageStorage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
};

/**
 * Whether the intro card shows, and what hides or shows it. `blank`: nothing has been entered in the build yet.
 *  - `dismiss`: the close button; remembered in this browser
 *  - `buildByHand`: hidden for this visit only
 *  - `show`: "Getting started" in the ⋮ menu; shows it whatever the rest says, until it is closed again
 *  - `afterReset`: the build was reset, so a card hidden by `buildByHand` comes back (one closed stays closed)
 */
export function useIntroCard(blank: boolean) {
    const [dismissed, setDismissed] = useState(() => readIntroDismissed(pageStorage));
    const [builtByHand, setBuiltByHand] = useState(false);
    const [forced, setForced] = useState(false);

    const dismiss = useCallback(() => {
        writeIntroDismissed(pageStorage);
        setDismissed(true);
        setForced(false);
    }, []);
    const buildByHand = useCallback(() => {
        setBuiltByHand(true);
        setForced(false);
    }, []);
    const show = useCallback(() => setForced(true), []);
    const afterReset = useCallback(() => setBuiltByHand(false), []);

    return { visible: shouldShowIntro({ dismissed, builtByHand, forced, blank }), dismiss, buildByHand, show, afterReset };
}
