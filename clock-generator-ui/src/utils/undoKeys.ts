// Which key presses Undo answers, kept apart from the DOM so they are tested in Node

/** What these functions read of an element: its tag, an input's type, and whether it is editable or in a given place */
interface ElementLike {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
}

/** Inputs whose Ctrl+Z is the browser's own, undoing the typing */
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** A field the player types into, where Ctrl+Z is the browser's undo of the typing */
export function isTextField(element: ElementLike | null): boolean {
    if (!element) {
        return false;
    }
    if (element.isContentEditable || element.tagName === 'TEXTAREA') {
        return true;
    }
    return element.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.has(element.type ?? 'text');
}

/** Ctrl+Z, or Cmd+Z on a Mac; not with Shift (redo) or Alt */
export function isUndoShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
    return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
}

/** A dialog other than the fullscreen diagram, which is a view of the build rather than an edit of one entity */
const OTHER_DIALOG = '.MuiDialog-root:not([data-fullscreen-diagram])';
/** Where an Escape is for something else: a dialog (but the fullscreen diagram), a menu, a Select's or Autocomplete's list */
const POPUP = `${OTHER_DIALOG}, .MuiPopover-root, .MuiPopper-root, [role="listbox"], [role="menu"]`;

/** Inside a dialog that edits by index, where an Undo would change what the dialog shows under it */
export function isInOtherDialog(element: ElementLike | null): boolean {
    return Boolean(element?.closest?.(OTHER_DIALOG));
}

/**
 * Whether an Escape was meant for something else than the message: something handled it already, or focus is in a
 * popup or dialog, which Escape closes. Then it must not also close the message, which may hold the only Undo.
 */
export function isEscapeForSomethingElse(event: { defaultPrevented: boolean }, focused: ElementLike | null): boolean {
    return event.defaultPrevented || Boolean(focused?.closest?.(POPUP));
}
