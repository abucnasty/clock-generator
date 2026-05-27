import { Alert, AlertTitle, Box, Button, Stack, Typography } from '@mui/material';
import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { FactorioIcon } from './FactorioIcon';

interface Props {
    issues: InserterCoverageIssue[];
    onApplyFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
}

function fixLabel(fix: InserterFixOption): string {
    switch (fix.type) {
        case 'machine_to_machine':
            return `From Machine ${fix.source_machine_id}`;
        case 'add_lane_to_existing_belt':
            return `Add to Belt ${fix.belt_id}`;
        case 'new_belt':
            return 'Add New Belt';
        case 'infinity_chest':
            return 'Use Infinity Chest';
    }
}

export function MissingInserterAlert({ issues, onApplyFix }: Props) {
    if (issues.length === 0) return null;

    return (
        <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>Missing Inserter Coverage</AlertTitle>
            <Stack spacing={1.5}>
                {issues.map((issue, i) => (
                    <Box
                        key={i}
                        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
                    >
                        <FactorioIcon name={issue.item_name} size={20} />
                        <Typography variant="body2" sx={{ flexShrink: 0 }}>
                            <strong>Machine {issue.machine_id}</strong> ({issue.recipe}):{' '}
                            missing{' '}
                            {issue.kind === 'missing_input_inserter' ? 'input' : 'output'}{' '}
                            inserter for <strong>{issue.item_name}</strong>
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {issue.fix_options.map((fix, j) => (
                                <Button
                                    key={j}
                                    size="small"
                                    variant="outlined"
                                    color="error"
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
