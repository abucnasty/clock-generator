import { describe, expect, it } from 'vitest';
import { isEscapeForSomethingElse, isInOtherDialog, isTextField, isUndoShortcut } from './undoKeys';

const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

/** An element inside the places the selectors name */
const inside = (...places: string[]) => ({
    tagName: 'BUTTON',
    closest: (selector: string) => (places.some((place) => selector.split(', ').some((part) => part.startsWith(place))) ? {} : null),
});

describe('isUndoShortcut', () => {
    it('is Ctrl+Z or Cmd+Z, in either case', () => {
        expect(isUndoShortcut(key('z', { ctrlKey: true }))).toBe(true);
        expect(isUndoShortcut(key('z', { metaKey: true }))).toBe(true);
        expect(isUndoShortcut(key('Z', { ctrlKey: true }))).toBe(true);
    });

    it('is not Z alone, nor with Shift (redo) or Alt, nor another key', () => {
        expect(isUndoShortcut(key('z'))).toBe(false);
        expect(isUndoShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(isUndoShortcut(key('z', { metaKey: true, altKey: true }))).toBe(false);
        expect(isUndoShortcut(key('y', { ctrlKey: true }))).toBe(false);
    });
});

describe('isTextField', () => {
    it('is a text, number or search input, an input without a type, a textarea, or editable content', () => {
        expect(isTextField({ tagName: 'INPUT', type: 'text' })).toBe(true);
        expect(isTextField({ tagName: 'INPUT', type: 'number' })).toBe(true);
        expect(isTextField({ tagName: 'INPUT', type: 'search' })).toBe(true);
        expect(isTextField({ tagName: 'INPUT' })).toBe(true);
        expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true);
        expect(isTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    });

    it('is not a checkbox, a switch, a radio, a button or nothing', () => {
        expect(isTextField({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
        expect(isTextField({ tagName: 'INPUT', type: 'radio' })).toBe(false);
        expect(isTextField({ tagName: 'BUTTON' })).toBe(false);
        expect(isTextField({ tagName: 'BODY' })).toBe(false);
        expect(isTextField(null)).toBe(false);
    });
});

describe('isInOtherDialog', () => {
    it('is true in a dialog, but not in the fullscreen diagram or on the page', () => {
        expect(isInOtherDialog(inside('.MuiDialog-root:not([data-fullscreen-diagram])'))).toBe(true);
        expect(isInOtherDialog(inside())).toBe(false);
        expect(isInOtherDialog(null)).toBe(false);
    });
});

describe('isEscapeForSomethingElse', () => {
    it('is true when something handled the Escape already', () => {
        expect(isEscapeForSomethingElse({ defaultPrevented: true }, inside())).toBe(true);
    });

    it('is true with focus in a Select\'s list, a menu, a popover or a dialog', () => {
        expect(isEscapeForSomethingElse({ defaultPrevented: false }, inside('[role="listbox"]'))).toBe(true);
        expect(isEscapeForSomethingElse({ defaultPrevented: false }, inside('[role="menu"]'))).toBe(true);
        expect(isEscapeForSomethingElse({ defaultPrevented: false }, inside('.MuiPopover-root'))).toBe(true);
        expect(isEscapeForSomethingElse({ defaultPrevented: false }, inside('.MuiDialog-root:not([data-fullscreen-diagram])'))).toBe(true);
    });

    it('is false on the page, in the message, or with nothing focused', () => {
        expect(isEscapeForSomethingElse({ defaultPrevented: false }, inside())).toBe(false);
        expect(isEscapeForSomethingElse({ defaultPrevented: false }, null)).toBe(false);
    });
});
