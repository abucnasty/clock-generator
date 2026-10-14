import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { forwardRef } from 'react';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { ELEMENT_IDS, type Problem } from '../utils/firstProblem';
import { TransferPlanPanel } from './TransferPlanPanel';

interface ValidationPanelProps {
    validation: ValidationState;
    /** The config was edited after it was validated */
    isOutOfDate: boolean;
    onValidate: () => void;
    /** The form is filled in far enough to be checked (recipe, machines, inserters for every ingredient) */
    canValidate: boolean;
    /** Why Validate is off, if the build has a problem */
    problem: Problem | null;
    isGenerating: boolean;
    excludedIngredients: string[];
    onExcludeChange: (items: string[]) => void;
}

const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

/**
 * The step between configuring and generating: checks that a clock can be planned for the config and shows the
 * transfer plan it would use. Runs only when asked; editing the config afterwards marks the result out of date.
 */
export const ValidationPanel = forwardRef<HTMLDivElement, ValidationPanelProps>(function ValidationPanel({
    validation,
    isOutOfDate,
    onValidate,
    canValidate,
    problem,
    isGenerating,
    excludedIngredients,
    onExcludeChange,
}, ref) {
    const isRunning = validation.status === 'running';

    return (
        <Paper ref={ref} sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="h6" sx={{ flexGrow: 1 }}>Validation</Typography>
                <Button
                    variant="outlined"
                    onClick={onValidate}
                    disabled={!canValidate || isRunning || isGenerating}
                    startIcon={isRunning ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                    {isRunning ? 'Validating...' : validation.status === 'none' ? 'Validate' : 'Validate again'}
                </Button>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Checks that a clock can be planned for this configuration and works out the transfer plan: how many hands each
                inserter moves per crafting cycle, and how many cycles the clock needs for them to come out whole. Nothing is
                recalculated while you edit; validate again when you are done. Generating needs a valid, up-to-date configuration.
            </Typography>

            {validation.status === 'none' && problem && (
                <Alert severity="info">{problem.text}</Alert>
            )}

            {validation.status === 'invalid' && !isOutOfDate && (
                <Alert
                    id={ELEMENT_IDS.validationError}
                    tabIndex={-1}
                    severity="error"
                    // a visible outline when "The last check failed" in the workflow bar moves the focus here
                    sx={{ '&:focus': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: 2 } }}
                >
                    {validation.message}
                </Alert>
            )}

            {validation.status !== 'none' && validation.status !== 'running' && isOutOfDate && (
                <Alert severity="warning">
                    The configuration changed since it was validated. Validate again to check it and refresh the transfer plan.
                </Alert>
            )}

            {validation.status === 'valid' && (
                <Box inert={isOutOfDate} sx={{ mt: 1.5, opacity: isOutOfDate ? 0.45 : 1, pointerEvents: isOutOfDate ? 'none' : 'auto' }}>
                    {!isOutOfDate && (
                        <Alert severity="success" sx={{ mb: 1 }}>
                            The configuration is valid. Each output inserter takes {validation.validation.output_swings_per_cycle} hand
                            {validation.validation.output_swings_per_cycle === 1 ? '' : 's'} per crafting cycle of{' '}
                            {formatTicks(validation.validation.cycle_ticks)} ticks, and the clock repeats every{' '}
                            {formatTicks(validation.validation.period_ticks)} ticks ({validation.validation.used_lcm} cycle
                            {validation.validation.used_lcm === 1 ? '' : 's'}). A generation may still lower the output swings
                            if this count turns out unstable.
                        </Alert>
                    )}
                    <TransferPlanPanel
                        transferPlan={validation.validation.transfer_plan}
                        usedLcm={validation.validation.used_lcm}
                        excludedIngredients={excludedIngredients}
                        onExcludeChange={onExcludeChange}
                    />
                </Box>
            )}
        </Paper>
    );
});
