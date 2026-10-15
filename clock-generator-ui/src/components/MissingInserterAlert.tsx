import { Alert, AlertTitle, Box, Button, Stack, Typography } from '@mui/material';
import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { entityLabel } from '../utils/entityLabel';
import { coverageIssueElementId } from '../utils/firstProblem';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';

interface Props {
    issues: InserterCoverageIssue[];
    onApplyFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
    /** The rows take the ids a problem in the workflow bar focuses; off for a second copy of the alert, so ids stay unique */
    focusTargets?: boolean;
}

function fixLabel(fix: InserterFixOption): string {
    switch (fix.type) {
        case 'machine_to_machine':
            return `From ${entityLabel('machine', fix.source_machine_id)}`;
        case 'add_lane_to_existing_belt':
            return `Add to ${entityLabel('belt', fix.belt_id)}`;
        case 'new_belt':
            return 'Add New Belt';
        case 'infinity_chest':
            return 'Use Infinity Chest';
    }
}

export function MissingInserterAlert({ issues, onApplyFix, focusTargets = true }: Props) {
    if (issues.length === 0) return null;

    return (
        <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>Missing Inserter Coverage</AlertTitle>
            <Stack spacing={1.5}>
                {issues.map((issue, i) => (
                    <Box
                        key={i}
                        // a problem in the workflow bar focuses the row, not one of its fixes, which would change the build
                        id={focusTargets ? coverageIssueElementId(issue) : undefined}
                        tabIndex={focusTargets ? -1 : undefined}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1,
                            '&:focus': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: 2 },
                        }}
                    >
                        <FactorioIcon name={issue.item_name} size={20} alt="" />
                        {/* wraps in a narrow window instead of running out of the row */}
                        <Typography variant="body2" sx={{ minWidth: 0 }}>
                            <strong>{entityLabel('machine', issue.machine_id)}</strong> (<GameName id={issue.recipe} kind="recipe" />):{' '}
                            missing{' '}
                            {issue.kind === 'missing_input_inserter' ? 'input' : 'output'}{' '}
                            inserter for <strong><GameName id={issue.item_name} /></strong>
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {issue.fix_options.map((fix, j) => (
                                <Button
                                    key={j}
                                    size="small"
                                    variant="outlined"
                                    // in the alert's own text colour: red text is for a card or the bar, not the alert's red tint
                                    color="inherit"
                                    onClick={() => onApplyFix(issue, fix)}
                                    sx={{ fontSize: '0.7rem', py: 0.25, px: 1 }}
                                >
                                    {fixLabel(fix)}
                                </Button>
                            ))}
                        </Box>
                    </Box>
                ))}
            </Stack>
        </Alert>
    );
}
