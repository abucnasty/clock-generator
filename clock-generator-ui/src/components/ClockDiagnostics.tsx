import { Box } from '@mui/material';
import type { ClockAlternativeView } from '../worker/types';
import { outputTermOf, SUMMARY_COPY } from '../utils/clockSummary';
import { diagnosticsNoteOf, notesOf } from '../utils/diagnostics';
import { LaneDiagnostics } from './CheckedLanesView';
import { InsightCard } from './InsightsPanel';
import { OutputChart } from './OutputChart';
import { TestPipeline } from './TestPipeline';

/**
 * The Diagnostics tab of the selected clock: the tests it went through, first; for a clock whose status is Oscillates, the
 * output of each window cycle of its run; then why it is not stable (diagnosticsNoteOf); then what was checked on the
 * lanes its copies share
 */
export function ClockDiagnostics({ clock, onSelectClock }: { clock: ClockAlternativeView; onSelectClock?: (id: string) => void }) {
    const note = notesOf(clock).diagnostics;
    // the numbers of the status Oscillates, as the status reads them (outputTermOf)
    const reason = outputTermOf(clock).term === SUMMARY_COPY.oscillates ? clock.asBuilt?.output_reason : undefined;
    const oscillates = reason?.code === 'oscillation';
    return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2, minWidth: 0 }} data-diagnostics="">
        <TestPipeline clock={clock} />
        {oscillates && <OutputChart facts={reason.data} copies={clock.copies} />}
        {note && <InsightCard insight={diagnosticsNoteOf(note, oscillates)} level={3} />}
        <LaneDiagnostics clock={clock} onSelectClock={onSelectClock} />
    </Box>;
}
