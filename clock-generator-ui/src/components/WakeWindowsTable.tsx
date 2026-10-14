import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { WAKE_UPS_HEADER, formatNumberText } from '../utils/numberText';
import { ticksToSeconds, type WakeWindowRow } from '../utils/wakeWindows';
import {
    NO_WINDOWS_TEXT,
    ROWS_TABLE_CAPTION,
    ROWS_TABLE_HEADERS,
    ROWS_TABLE_LABEL,
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

interface WakeWindowsTableProps {
    rows: WakeWindowRow[];
    periodTicks: number;
    mostWakeUpsId: string | null;
}

/** The table's own styles put a caption below it; these put it above, as the table's title */
const tableSx = {
    minWidth: 720,
    '& caption': { captionSide: 'top', textAlign: 'left', px: 0, pt: 0, pb: 1, color: 'text.primary', fontWeight: 600 },
} as const;
/** A table wider than the page scrolls inside this box, never the page */
const scrollSx = { overflowX: 'auto', mb: 3, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } } as const;
const num = (value: number) => formatNumberText(value);

/** The chart's numbers as two tables: one row per inserter and drill, and one row per wake window */
export function WakeWindowsTable({ rows, periodTicks, mostWakeUpsId }: WakeWindowsTableProps) {
    const windowRows = rows.flatMap(row => row.windows.map((window, index) => ({ row, window, index })));
    return (
        <Box data-wake-tables>
            <Box tabIndex={0} role="region" aria-label={ROWS_TABLE_LABEL} sx={scrollSx}>
                <Table size="small" sx={tableSx}>
                    <caption>{ROWS_TABLE_CAPTION}</caption>
                    <TableHead>
                        <TableRow>
                            <TableCell scope="col">{ROWS_TABLE_HEADERS.name}</TableCell>
                            <TableCell scope="col">{ROWS_TABLE_HEADERS.moves}</TableCell>
                            <TableCell scope="col" align="right">{ROWS_TABLE_HEADERS.onFor}</TableCell>
                            <TableCell scope="col" align="right">{ROWS_TABLE_HEADERS.windows}</TableCell>
                            <TableCell scope="col" align="right">{WAKE_UPS_HEADER}</TableCell>
                            <TableCell scope="col">{ROWS_TABLE_HEADERS.notes}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(row => (
                            <TableRow key={row.id}>
                                <TableCell component="th" scope="row" sx={{ whiteSpace: 'nowrap' }}>{row.label}</TableCell>
                                <TableCell sx={{ minWidth: 200 }}>{row.detail}</TableCell>
                                <TableCell align="right">{onShareText(row.onShare)}</TableCell>
                                <TableCell align="right">{windowCountText(row)}</TableCell>
                                <TableCell align="right">{wakeUpsText(row)}</TableCell>
                                <TableCell sx={{ minWidth: 280 }}>
                                    {watchNotes(row, { periodTicks, mostWakeUpsId }).map(note => note.text).join(' ')}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>

            <Box tabIndex={0} role="region" aria-label={WINDOWS_TABLE_LABEL} sx={scrollSx}>
                <Table size="small" sx={tableSx}>
                    <caption>{WINDOWS_TABLE_CAPTION}</caption>
                    <TableHead>
                        <TableRow>
                            <TableCell scope="col">{WINDOWS_TABLE_HEADERS.name}</TableCell>
                            <TableCell scope="col">{WINDOWS_TABLE_HEADERS.window}</TableCell>
                            <TableCell scope="col" align="right">{WINDOWS_TABLE_HEADERS.starts}</TableCell>
                            <TableCell scope="col" align="right">{WINDOWS_TABLE_HEADERS.ends}</TableCell>
                            <TableCell scope="col" align="right">{WINDOWS_TABLE_HEADERS.lengthTicks}</TableCell>
                            <TableCell scope="col" align="right">{WINDOWS_TABLE_HEADERS.lengthSeconds}</TableCell>
                            <TableCell scope="col" align="right">{WINDOWS_TABLE_HEADERS.slack}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {windowRows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7}>{NO_WINDOWS_TEXT}</TableCell>
                            </TableRow>
                        )}
                        {windowRows.map(({ row, window, index }) => (
                            <TableRow key={`${row.id}-${index}`}>
                                <TableCell component="th" scope="row" sx={{ whiteSpace: 'nowrap' }}>{row.label}</TableCell>
                                <TableCell>{windowOrdinalText(index, row.windows.length)}</TableCell>
                                <TableCell align="right">{num(window.start)}</TableCell>
                                <TableCell align="right">{windowEndText(window)}</TableCell>
                                <TableCell align="right">{num(window.length)}</TableCell>
                                <TableCell align="right">{num(ticksToSeconds(window.length))}</TableCell>
                                <TableCell align="right">{num(window.slackTicks)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>
        </Box>
    );
}
