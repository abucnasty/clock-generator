import { Box } from '@mui/material';
import type { ClockAlternativeView } from '../worker/types';
import { notesOf } from '../utils/diagnostics';
import { LaneDiagnostics } from './CheckedLanesView';
import { InsightCard } from './InsightsPanel';
import { TestPipeline } from './TestPipeline';

/**
 * The Diagnostics tab of the selected clock: the tests it went through, first; then why it is not stable, as Overview's notes
 * showed it; then what was checked on the lanes its copies share
 */
export function ClockDiagnostics({ clock, onSelectClock }: { clock: ClockAlternativeView; onSelectClock?: (id: string) => void }) {
    const note = notesOf(clock).diagnostics;
    return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2, minWidth: 0 }} data-diagnostics="">
        <TestPipeline clock={clock} />
        {note && <InsightCard insight={note} level={3} />}
        <LaneDiagnostics clock={clock} onSelectClock={onSelectClock} />
    </Box>;
}
