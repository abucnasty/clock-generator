import { Table, TableBody, TableCell, TableHead, TableRow, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import { ScrollX } from './ScrollX';

interface DataColumn<Row> {
    header: ReactNode;
    cell: (row: Row, index: number) => ReactNode;
    /** Numbers go right */
    align?: 'left' | 'right' | 'center';
    /** The cell names its row: a row header, for a screen reader to say with the row's other cells */
    rowHeader?: boolean;
    sx?: SxProps<Theme>;
}

interface DataTableProps<Row> {
    /** The name of the box the table scrolls in, when it is wider than the page */
    label: string;
    /** The table's title, above it */
    caption?: ReactNode;
    /** A column that is `false` is left out */
    columns: (DataColumn<Row> | false)[];
    rows: readonly Row[];
    rowKey: (row: Row, index: number) => string | number;
    /** What the table says when it has no rows */
    empty?: ReactNode;
    /** The width below which the table scrolls sideways instead of squeezing its columns */
    minWidth?: number;
    rowSx?: (row: Row) => SxProps<Theme> | undefined;
    sx?: SxProps<Theme>;
}

/** A small table of numbers, one row per thing, in a box that scrolls sideways on a narrow screen */
export function DataTable<Row>({ label, caption, columns, rows, rowKey, empty, minWidth, rowSx, sx }: DataTableProps<Row>) {
    const shown = columns.filter((column): column is DataColumn<Row> => column !== false);
    return <ScrollX label={label} minWidth={minWidth} sx={sx}>
        <Table size="small" sx={caption ? { '& caption': { captionSide: 'top', textAlign: 'left', px: 0, pt: 0, pb: 1, color: 'text.primary', fontWeight: 600 } } : undefined}>
            {caption && <caption>{caption}</caption>}
            <TableHead>
                <TableRow>
                    {shown.map((column, index) => <TableCell key={index} scope="col" align={column.align}>{column.header}</TableCell>)}
                </TableRow>
            </TableHead>
            <TableBody>
                {rows.length === 0 && empty && <TableRow><TableCell colSpan={shown.length}>{empty}</TableCell></TableRow>}
                {rows.map((row, rowIndex) => <TableRow key={rowKey(row, rowIndex)} sx={rowSx?.(row)}>
                    {shown.map((column, index) => <TableCell key={index} align={column.align} sx={column.sx}
                        {...(column.rowHeader && { component: 'th', scope: 'row' })}>
                        {column.cell(row, rowIndex)}
                    </TableCell>)}
                </TableRow>)}
            </TableBody>
        </Table>
    </ScrollX>;
}
