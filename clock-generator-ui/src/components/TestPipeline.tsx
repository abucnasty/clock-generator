import { Cancel, CheckCircle, ErrorOutline, RemoveCircleOutline } from '@mui/icons-material';
import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { TEST_PIPELINE_COPY, testPipelineOf, type PipelineClock, type TestState } from '../utils/testPipeline';

/** The icon of a state, with the state's name for a screen reader; never the colour alone, the result says it too */
const STATE_ICON: Record<TestState, (name: string) => ReactNode> = {
    passed: name => <CheckCircle titleAccess={name} sx={{ color: 'secondary.light' }} />,
    failed: name => <Cancel titleAccess={name} sx={{ color: 'error.light' }} />,
    'not-run': name => <RemoveCircleOutline titleAccess={name} sx={{ color: 'text.secondary' }} />,
    'does-not-apply': name => <RemoveCircleOutline titleAccess={name} sx={{ color: 'text.secondary' }} />,
    error: name => <ErrorOutline titleAccess={name} sx={{ color: 'error.main' }} />,
};

/** A box's edge: a failed test and an error stand out; a test that did not run is dashed */
const EDGE: Record<TestState, { borderColor: string; borderStyle: string }> = {
    passed: { borderColor: 'divider', borderStyle: 'solid' },
    failed: { borderColor: 'error.light', borderStyle: 'solid' },
    error: { borderColor: 'error.main', borderStyle: 'solid' },
    'not-run': { borderColor: 'divider', borderStyle: 'dashed' },
    'does-not-apply': { borderColor: 'divider', borderStyle: 'dashed' },
};

/**
 * The tests of the selected clock, first on its Diagnostics tab: one copy alone, all the copies together, the loss of inputs.
 * Three boxes in a row, stacked on a narrow page; each with its state, the test's name, the result in bold and one line.
 */
export function TestPipeline({ clock }: { clock: PipelineClock }) {
    return <Box component="ol" aria-label={TEST_PIPELINE_COPY.heading} data-test-pipeline=""
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' } }}>
        {testPipelineOf(clock).map(box => <Box component="li" key={box.test} data-test={box.test} data-test-state={box.state}
            sx={{ minWidth: 0, border: 1, ...EDGE[box.state], borderRadius: 1, px: 1.5, py: 1.25, display: 'grid', gap: 0.5, alignContent: 'start' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {STATE_ICON[box.state](TEST_PIPELINE_COPY.states[box.state])}
                <Typography variant="overline" component="p" color="text.secondary" sx={{ lineHeight: 1.4 }}>{box.name}</Typography>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }} data-test-result="">{box.result}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }} data-test-detail="">{box.detail}</Typography>
        </Box>)}
    </Box>;
}
