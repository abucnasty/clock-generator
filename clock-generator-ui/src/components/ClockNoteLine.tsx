import { Box } from '@mui/material';
import type { ClockInsight } from 'clock-generator/browser';
import type { ReactNode } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { CLOCK_NOTE_COPY, clockNoteInserters, clockNoteMark } from '../utils/clockNotes';
import { InsightTable } from './InsightTable';
import { InserterChipIcon, NoteChips, NoteFacts, NoteLine } from './NoteLine';

/** An inserter of the saved configuration, as its chip draws it */
export type NoteInserter = { id?: number; prototype?: string; quality?: string };

/** One note on the selected clock as a line in its frame, as the Build check frames its advisories */
export function ClockNoteFrame({ mark, title, chips, insight, children }: {
    mark: 'caution' | 'info'; title: string; chips?: ReactNode; insight?: string; children: ReactNode;
}) {
    const color = mark === 'caution' ? 'warning' : 'info';
    return <Box role="group" aria-label={title} data-insight={insight}
        sx={{ p: 1, mb: 1, border: 1, borderColor: 'divider', borderLeft: 3, borderLeftColor: `${color}.main` }}>
        <NoteLine mark={color} markLabel={CLOCK_NOTE_COPY.marks[mark]} title={title} chips={chips} details={CLOCK_NOTE_COPY.details} maxWidth="md">
            {children}
        </NoteLine>
    </Box>;
}

/** A note the engine made for the selected clock as one line; its window holds the note's table, then its words */
export function ClockNoteLine({ insight, inserters = [] }: { insight: ClockInsight; inserters?: readonly NoteInserter[] }) {
    const { nameIdsIn } = useGameNames();
    const title = nameIdsIn(insight.title);
    const ids = clockNoteInserters(insight);
    const labels = CLOCK_NOTE_COPY.labels;
    const words = ([[labels.what, insight.what], [labels.why, insight.why], [labels.explanation, insight.explanation]] as [string, string][])
        .filter(([, text]) => text !== '').map(([label, text]): [string, string] => [label, nameIdsIn(text)]);
    return <ClockNoteFrame mark={clockNoteMark(insight)} title={title} insight={insight.id}
        chips={ids.length > 0 && <NoteChips label={CLOCK_NOTE_COPY.chips.inserters} kind="inserter" ids={ids}
            icon={id => <InserterChipIcon value={inserters.find((inserter, index) => (inserter.id ?? index + 1) === id)} />} />}>
        <Box sx={{ display: 'grid', gap: 2 }}>
            {insight.table && <InsightTable table={insight.table} title={insight.title} />}
            <NoteFacts rows={words} />
        </Box>
    </ClockNoteFrame>;
}
