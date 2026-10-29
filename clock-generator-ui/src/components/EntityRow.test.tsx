// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { useEntityRows } from '../hooks/useEntityRows';
import { show } from '../test/fixtures';
import { rowActionsName } from '../utils/a11yLabels';
import { entityLabel, settingsSlotId } from '../utils/entityLabel';
import { AddButton } from './AddRow';
import { EntityRow, EntityRowActions, EntityRowTop } from './EntityRow';
import { SortableList } from './SortableList';

type Row = { id: number; _uuid: string; drop?: boolean };

/** A section as the build's sections are: rows with their actions, an Add button, and the focus handling */
function Section({ initial, refusal }: { initial: Row[]; refusal?: string }) {
    const [rows, setRows] = useState(initial);
    const nextId = () => Math.max(0, ...rows.map(row => row.id)) + 1;
    const reorder = (from: number, to: number) => setRows(current => {
        const next = [...current];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
    });
    const { cardRef, add, duplicate, remove } = useEntityRows(rows, {
        labelOf: row => entityLabel('belt', row.id),
        onRemove: index => setRows(current => current.filter((_, i) => i !== index)),
        onDuplicate: index => setRows(current => [...current, { ...current[index], id: nextId(), _uuid: `copy-${nextId()}` }]),
        duplicateRefusal: (row, label) => row.drop && refusal ? `${label} ${refusal}` : null,
    });
    return <section ref={cardRef}>
        <AddButton label="Add Belt" onClick={() => add(() => setRows(current => [...current, { id: nextId(), _uuid: `new-${nextId()}` }]))} />
        <SortableList itemKeys={rows.map(row => row._uuid)} onReorder={reorder}>
            {rows.map((row, index) => <EntityRow key={row._uuid} kind="belt" row={row} label={entityLabel('belt', row.id)}>
                {dragHandle => <EntityRowTop dragHandle={dragHandle} actions={<EntityRowActions kind="belt" id={row.id} label={entityLabel('belt', row.id)}
                    index={index} count={rows.length} onReorder={reorder} onDuplicate={duplicate} onDelete={remove} />}>
                    <input data-row-first="" aria-label={`Field of ${entityLabel('belt', row.id)}`} />
                </EntityRowTop>}
            </EntityRow>)}
        </SortableList>
    </section>;
}

const rows = (...ids: number[]) => ids.map(id => ({ id, _uuid: `belt-${id}` }));
const rowNames = () => screen.getAllByRole('group').map(group => group.getAttribute('aria-label'));
// the new row's field is focused on the frame after it mounts
const focused = (name: string) => waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name })));

it('names each row, finds it by kind and id, and leaves room for its Entity details button', () => {
    show(<Section initial={rows(1, 4)} />);
    expect(rowNames()).toEqual(['Belt 1', 'Belt 4']);
    expect(document.getElementById('entity-belt-4')).toBe(screen.getByRole('group', { name: 'Belt 4' }));
    expect(document.getElementById(settingsSlotId('belt', 4))).not.toBeNull();
});

it('announces an added row by the id after the largest, and moves the focus to its first field', async () => {
    const { user, announce } = show(<Section initial={rows(1, 4)} />);
    await user.click(screen.getByRole('button', { name: 'Add Belt' }));
    expect(announce).toHaveBeenCalledWith('Added Belt 5.');
    await focused('Field of Belt 5');
});

it('duplicates from the row menu, saying what was copied', async () => {
    const { user, announce } = show(<Section initial={rows(1, 2)} />);
    await user.click(screen.getByRole('button', { name: rowActionsName('Belt 1') }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(rowNames()).toEqual(['Belt 1', 'Belt 2', 'Belt 3']);
    expect(announce).toHaveBeenCalledWith('Added Belt 3, a copy of Belt 1.');
    await focused('Field of Belt 3');
});

it('says why a row cannot be duplicated instead of duplicating it', async () => {
    const { user, announce } = show(<Section initial={[{ id: 1, _uuid: 'belt-1', drop: true }]} refusal="has a drop of its own." />);
    await user.click(screen.getByRole('button', { name: rowActionsName('Belt 1') }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(rowNames()).toEqual(['Belt 1']);
    expect(announce).toHaveBeenCalledExactlyOnceWith('Belt 1 has a drop of its own.');
});

it('moves rows from the menu, offering only the moves there are', async () => {
    const { user } = show(<Section initial={rows(1, 2)} />);
    await user.click(screen.getByRole('button', { name: rowActionsName('Belt 1') }));
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(rowNames()).toEqual(['Belt 2', 'Belt 1']);
});

it.each([
    { why: 'to the row that took its place', ids: [1, 2], removed: 'Belt 1', focusedButton: 'Delete Belt 2' },
    { why: 'to the row before when it was the last', ids: [1, 2], removed: 'Belt 2', focusedButton: 'Delete Belt 1' },
    { why: 'to Add when it was the only row', ids: [1], removed: 'Belt 1', focusedButton: 'Add Belt' },
])('moves the focus on Delete $why', async ({ ids, removed, focusedButton }) => {
    const { user } = show(<Section initial={rows(...ids)} />);
    await user.click(screen.getByRole('button', { name: `Delete ${removed}` }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: focusedButton }));
});
