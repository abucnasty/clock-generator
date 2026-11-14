import type { ClockInsight } from 'clock-generator/browser';
import type { ReactNode } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { DataTable } from './DataTable';
import { GameName } from './GameName';

/** A cell that is a number, with a unit or none: "12", "4.5 ticks", "93%", "240/s" */
const NUMERIC_CELL = /^[-+−]?\d[\d,.]*\s*(ticks?|%|\/s|\/min|s|×)?$/;

/** The columns whose every cell is a number, which line up on the right as numbers do */
function numericColumns(table: NonNullable<ClockInsight['table']>): boolean[] {
    return table.columns.map((_, column) => {
        const cells = table.rows.map(row => (row[column] ?? '').trim()).filter(cell => cell !== '' && cell !== '—');
        return cells.length > 0 && cells.every(cell => NUMERIC_CELL.test(cell));
    });
}

/** The numbers behind a note's words, as the engine gives them */
export function InsightTable({ table, title }: { table: NonNullable<ClockInsight['table']>; title: string }) {
    const { names, nameIdsIn } = useGameNames();
    const numeric = numericColumns(table);
    // a cell that is exactly an id of the game data shows its name; the engine's other text is left as it is
    const cellOf = (cell: string, columnName: string): ReactNode => {
        if (columnName === 'Recipe' && Object.hasOwn(names.recipe, cell)) return <GameName id={cell} kind="recipe" />;
        if (Object.hasOwn(names.recipe, cell) && !Object.hasOwn(names.item, cell)) return <GameName id={cell} kind="recipe" />;
        return Object.hasOwn(names.item, cell) ? <GameName id={cell} /> : nameIdsIn(cell);
    };
    return (
        <DataTable label={`${title} table`} sx={{ mt: 1 }} rows={table.rows} rowKey={(_, index) => index}
            columns={table.columns.map((column, index) => ({ header: column, align: numeric[index] ? 'right' as const : 'left' as const, cell: (row: string[]) => cellOf(row[index], column) }))} />
    );
}
