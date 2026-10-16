/**
 * Writes text into a polite live region that a screen reader will read: one that is not under `aria-hidden` when the
 * text is written, and that was in the page, empty, before it.
 *
 * The main region lives in the app. While a dialog is open, or closing, MUI hides every other child of `<body>`, the
 * app's root included, with `aria-hidden`, so text written there is never read. Then the text goes to a second region,
 * appended straight to `<body>` at that moment: MUI only hides (and later un-hides) the children that were there when
 * the dialog opened, so this one stays visible to screen readers. It is added empty and written a moment later, as a
 * region that appears with its text is often not read; it is reused while it stays visible, and removed when idle.
 * Only one region holds the text at a time.
 */

/** Hidden from sight, read by screen readers; as inline CSS, for an element made outside React */
const VISUALLY_HIDDEN_CSS = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
/** How long the second region waits, added and empty, before its text is written */
const WRITE_DELAY_MS = 100;
/** How long the second region stays after its last text */
const IDLE_MS = 15_000;

/** Marks every region that messages are announced in, for whoever needs to find them */
export const ANNOUNCER_ATTRIBUTE = 'data-message-announcer';

let spare: HTMLElement | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: ReturnType<typeof setTimeout> | undefined;

const isHidden = (element: Element) => element.closest('[aria-hidden="true"]') !== null;

function write(region: HTMLElement, text: string) {
    const node = document.createElement('span');
    node.textContent = text;
    // a new node, so the same text twice is read out twice
    region.replaceChildren(node);
}

function removeSpare() {
    spare?.remove();
    spare = null;
}

/** Announces in an exposed region; an owned completion rechecks its validity at the actual write. */
export function announceText(main: HTMLElement | null, text: string, stillCurrent?: () => boolean) {
    if (stillCurrent && !stillCurrent()) return;
    clearTimeout(pendingWrite);
    if (main && main.isConnected && !isHidden(main)) {
        spare?.replaceChildren();
        write(main, text);
        return;
    }
    main?.replaceChildren();
    if (!spare || !spare.isConnected || isHidden(spare)) {
        removeSpare();
        spare = document.createElement('div');
        spare.setAttribute('role', 'status');
        spare.setAttribute(ANNOUNCER_ATTRIBUTE, '');
        spare.style.cssText = VISUALLY_HIDDEN_CSS;
        document.body.append(spare);
    }
    const region = spare;
    region.replaceChildren();
    pendingWrite = setTimeout(() => {
        if (!stillCurrent || stillCurrent()) write(region, text);
    }, WRITE_DELAY_MS);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(removeSpare, IDLE_MS);
}
