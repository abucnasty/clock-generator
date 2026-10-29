// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFocusAfterRemove } from './useFocusAfterRemove';

let frame: (() => void) | undefined;
const cancel = vi.fn();

/** A list card whose rows' first fields mount a commit after the row, as through a Portal, which renders the list again */
function List() {
    const [rows, setRows] = useState([1]);
    const [mounted, setMounted] = useState(rows);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the second commit is what is under test
    useEffect(() => setMounted(rows), [rows]);
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(rows.length, index => setRows(rows.filter((_, i) => i !== index)));
    return <section ref={cardRef}>
        {rows.map((row, index) => <div key={row} role="group" aria-label={`Row ${row}`}>
            {mounted.includes(row) && <input data-row-first aria-label={`Row ${row} name`} />}
            <button data-row-delete onClick={() => remove(index)}>Delete row {row}</button>
        </div>)}
        <button data-row-add onClick={() => afterAdd(() => setRows([...rows, rows.length + 1]))}>Add</button>
    </section>;
}

beforeEach(() => {
    frame = undefined; cancel.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frame = callback; return 42; });
    vi.stubGlobal('cancelAnimationFrame', cancel);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('resolves the new row after its portal mounts, across incidental rerenders', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(<List />);
    const add = screen.getByRole('button', { name: 'Add' });
    await userEvent.setup().click(add);
    // the new row's field has mounted, and the list rendered again, before the animation frame
    const field = screen.getByRole('textbox', { name: 'Row 2 name' });
    expect(document.activeElement).toBe(add);
    expect(cancel).not.toHaveBeenCalled();
    act(() => frame!());
    expect(document.activeElement).toBe(field);
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('group', { name: 'Row 2' }));
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
});

it('cancels queued Add focus when deleting a row or unmounting the list', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<List />);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Delete row 2' }));
    expect(cancel).toHaveBeenCalledWith(42);
    cancel.mockClear();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    unmount();
    expect(cancel).toHaveBeenCalledWith(42);
});
