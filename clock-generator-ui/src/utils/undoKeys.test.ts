import { describe, expect, it } from 'vitest';
import { entersEditingDialog, entersOtherDialog, isEscapeForSomethingElse, isInOtherDialog, isTextField, isUndoShortcut } from './undoKeys';

// the selectors undoKeys.ts looks for, which it does not export
/** A rule or entity dialog */
const EDITING_DIALOG = '[data-edits-build]';
/** A dialog other than the fullscreen diagram, which is a `.MuiDialog-root` too, but has `data-fullscreen-diagram` */
const OTHER_DIALOG = '.MuiDialog-root:not([data-fullscreen-diagram])';

const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

/** An element inside the places the selectors name */
const inside = (...places: string[]) => ({
    tagName: 'BUTTON',
    closest: (selector: string) => (places.some((place) => selector.split(', ').some((part) => part.startsWith(place))) ? {} : null),
});

// focus on the page, and in a dialog: `inDialog(selector)` is in the `dialog` that selector finds, as `otherInside` is
const outside = { tagName: 'BUTTON' };
const otherInside = { tagName: 'INPUT' };
const dialog = { contains: (node: unknown) => node === otherInside };
const inDialog = (selector: string) => ({ tagName: 'DIV', closest: (asked: string) => (asked === selector ? dialog : null) });

describe('isUndoShortcut', () => {
    it.each([
        { name: 'Ctrl+Z', event: key('z', { ctrlKey: true }), undo: true },
        { name: 'Cmd+Z', event: key('z', { metaKey: true }), undo: true },
        { name: 'Ctrl+Z in upper case', event: key('Z', { ctrlKey: true }), undo: true },
        { name: 'Z alone', event: key('z'), undo: false },
        { name: 'Ctrl+Shift+Z (redo)', event: key('z', { ctrlKey: true, shiftKey: true }), undo: false },
        { name: 'Cmd+Alt+Z', event: key('z', { metaKey: true, altKey: true }), undo: false },
        { name: 'Ctrl with another key', event: key('y', { ctrlKey: true }), undo: false },
    ])('is $undo for $name', ({ event, undo }) => {
        expect(isUndoShortcut(event)).toBe(undo);
    });
});

describe('isTextField', () => {
    it.each([
        { name: 'a text input', element: { tagName: 'INPUT', type: 'text' }, text: true },
        { name: 'a number input', element: { tagName: 'INPUT', type: 'number' }, text: true },
        { name: 'a search input', element: { tagName: 'INPUT', type: 'search' }, text: true },
        { name: 'an input without a type', element: { tagName: 'INPUT' }, text: true },
        { name: 'a textarea', element: { tagName: 'TEXTAREA' }, text: true },
        { name: 'editable content', element: { tagName: 'DIV', isContentEditable: true }, text: true },
        { name: 'a checkbox, which a switch is too', element: { tagName: 'INPUT', type: 'checkbox' }, text: false },
        { name: 'a radio', element: { tagName: 'INPUT', type: 'radio' }, text: false },
        { name: 'a button', element: { tagName: 'BUTTON' }, text: false },
        { name: 'the page body', element: { tagName: 'BODY' }, text: false },
        { name: 'nothing', element: null, text: false },
    ])('is $text for $name', ({ element, text }) => {
        expect(isTextField(element)).toBe(text);
    });
});

describe('isInOtherDialog', () => {
    it.each([
        { where: 'in a dialog', focused: inside(OTHER_DIALOG), inOtherDialog: true },
        { where: 'on the page', focused: inside(), inOtherDialog: false },
        { where: 'with nothing focused', focused: null, inOtherDialog: false },
    ])('is $inOtherDialog $where', ({ focused, inOtherDialog }) => {
        expect(isInOtherDialog(focused)).toBe(inOtherDialog);
    });
});

describe('isEscapeForSomethingElse', () => {
    it.each([
        { why: 'something handled the Escape already', defaultPrevented: true, focused: inside(), forSomethingElse: true },
        { why: 'focus is in the list of a Select', defaultPrevented: false, focused: inside('[role="listbox"]'), forSomethingElse: true },
        { why: 'focus is in a menu', defaultPrevented: false, focused: inside('[role="menu"]'), forSomethingElse: true },
        { why: 'focus is in a popover', defaultPrevented: false, focused: inside('.MuiPopover-root'), forSomethingElse: true },
        { why: 'focus is in a dialog', defaultPrevented: false, focused: inside(OTHER_DIALOG), forSomethingElse: true },
        { why: 'focus is on the page or in the message', defaultPrevented: false, focused: inside(), forSomethingElse: false },
        { why: 'nothing is focused', defaultPrevented: false, focused: null, forSomethingElse: false },
    ])('is $forSomethingElse when $why', ({ defaultPrevented, focused, forSomethingElse }) => {
        expect(isEscapeForSomethingElse({ defaultPrevented }, focused)).toBe(forSomethingElse);
    });
});

// the two differ only in the dialog they look for
describe.each([
    ['entersEditingDialog', entersEditingDialog, EDITING_DIALOG],
    ['entersOtherDialog', entersOtherDialog, OTHER_DIALOG],
] as const)('%s', (_, enters, selector) => {
    it.each([
        { moves: 'comes into the dialog from the page', to: inDialog(selector), from: outside, entered: true },
        { moves: 'comes into the dialog from nowhere', to: inDialog(selector), from: null, entered: true },
        { moves: 'moves inside the dialog', to: inDialog(selector), from: otherInside, entered: false },
        { moves: 'lands outside any dialog', to: inside(), from: outside, entered: false },
        { moves: 'goes nowhere', to: null, from: outside, entered: false },
    ])('is $entered when focus $moves', ({ to, from, entered }) => {
        expect(enters(to, from)).toBe(entered);
    });
});
