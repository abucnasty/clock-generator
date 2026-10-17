import { Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { validationIssueElementId, type BuildValidationIssue } from '../utils/buildValidation';

/** The same issue frame and severity in the build and in unsaved entity drafts. */
export function ValidationPanel({ issues, children, focusTargets = true }: {
    issues: BuildValidationIssue[];
    children: (issue: BuildValidationIssue) => ReactNode;
    focusTargets?: boolean;
}) {
    if (!issues.length) return null;
    const errors = issues.filter(issue => issue.blocksGeneration);
    const advice = issues.filter(issue => !issue.blocksGeneration);
    return <Paper component="section" variant="outlined" aria-label="Build validation" id={focusTargets ? 'build-validation' : undefined}
        tabIndex={-1} sx={{ mb: 2, p: 1.5, '&:focus': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>Build validation</Typography>
            <Typography variant="caption" color="text.secondary">
                {[errors.length ? `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}` : '', advice.length ? `${advice.length} ${advice.length === 1 ? 'advisory' : 'advisories'}` : ''].filter(Boolean).join(' · ')}
            </Typography>
        </Box>
        <Box sx={{ maxHeight: focusTargets ? 480 : '35dvh', overflowY: 'auto', p: 0.5 }}>
            {[...errors, ...advice].map(issue => <Box key={issue.id} id={focusTargets ? validationIssueElementId(issue.id) : undefined}
                role="group" aria-label={issue.text} tabIndex={-1}
                sx={{ p: 1.5, mb: 1, border: 1, borderColor: 'divider', borderLeft: 3, borderLeftColor: `${issue.severity}.main`,
                    '&:last-child': { mb: 0 }, '&:focus': { outline: '2px solid', outlineColor: `${issue.severity}.main`, outlineOffset: 2 } }}>
                {!issue.blocksGeneration && <Typography variant="caption" color="text.secondary" component="p">Advisory · does not block generation</Typography>}
                {children(issue)}
            </Box>)}
        </Box>
    </Paper>;
}
