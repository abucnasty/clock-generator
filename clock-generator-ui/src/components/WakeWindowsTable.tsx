import { Box } from '@mui/material';
import { formatNumberText } from '../utils/numberText';
import { ticksToSeconds, type WakeWindowRow } from '../utils/wakeWindows';
import {
    NO_WINDOWS_TEXT,
    ROWS_TABLE_CAPTION,
    ROWS_TABLE_HEADERS,
    ROWS_TABLE_LABEL,
    ROWS_TABLE_WAKE_UPS_HEADER,
    WINDOWS_TABLE_CAPTION,
    WINDOWS_TABLE_HEADERS,
    WINDOWS_TABLE_LABEL,
    onShareText,
    wakeUpsText,
    watchNotes,
    windowCountText,
    windowEndText,
    windowOrdinalText,
} from '../utils/wakeWindowCopy';
import { DataTable } from './DataTable';
import { WakeRowMoves } from './WakeRowMoves';

interface WakeWindowsTableProps {
    rows: WakeWindowRow[];
    periodTicks: number;
    mostWakeUpsId: string | null;
}

const num = (value: number) => formatNumberText(value);
const NAME = { header: WINDOWS_TABLE_HEADERS.name, rowHeader: true, sx: { whiteSpace: 'nowrap' } } as const;

/** The chart's numbers as two tables: one row per inserter and drill, and one row per wake window */
export function WakeWindowsTable({ rows, periodTicks, mostWakeUpsId }: WakeWindowsTableProps) {
    const windowRows = rows.flatMap(row => row.windows.map((window, index) => ({ row, window, index })));
    return (
        <Box data-wake-tables sx={{ display: 'grid', gap: 3, mb: 3 }}>
            <DataTable label={ROWS_TABLE_LABEL} caption={ROWS_TABLE_CAPTION} minWidth={720} rows={rows} rowKey={row => row.id} columns={[
                { ...NAME, header: ROWS_TABLE_HEADERS.name, cell: row => row.label },
                { header: ROWS_TABLE_HEADERS.moves, cell: row => <WakeRowMoves row={row} />, sx: { minWidth: 200 } },
                { header: ROWS_TABLE_HEADERS.onFor, align: 'right', cell: row => onShareText(row.onShare) },
                { header: ROWS_TABLE_HEADERS.windows, align: 'right', cell: windowCountText },
                { header: ROWS_TABLE_WAKE_UPS_HEADER, align: 'right', cell: wakeUpsText },
                { header: ROWS_TABLE_HEADERS.notes, sx: { minWidth: 280 }, cell: row => watchNotes(row, { periodTicks, mostWakeUpsId }).map(note => note.text).join(' ') },
            ]} />
            <DataTable label={WINDOWS_TABLE_LABEL} caption={WINDOWS_TABLE_CAPTION} minWidth={720} rows={windowRows} rowKey={({ row, index }) => `${row.id}-${index}`}
                empty={NO_WINDOWS_TEXT} columns={[
                    { ...NAME, cell: ({ row }) => row.label },
                    { header: WINDOWS_TABLE_HEADERS.window, cell: ({ row, index }) => windowOrdinalText(index, row.windows.length) },
                    { header: WINDOWS_TABLE_HEADERS.starts, align: 'right', cell: ({ window }) => num(window.start) },
                    { header: WINDOWS_TABLE_HEADERS.ends, align: 'right', cell: ({ window }) => windowEndText(window) },
                    { header: WINDOWS_TABLE_HEADERS.lengthTicks, align: 'right', cell: ({ window }) => num(window.length) },
                    { header: WINDOWS_TABLE_HEADERS.lengthSeconds, align: 'right', cell: ({ window }) => num(ticksToSeconds(window.length)) },
                    { header: WINDOWS_TABLE_HEADERS.slack, align: 'right', cell: ({ window }) => num(window.slackTicks) },
                ]} />
        </Box>
    );
}
