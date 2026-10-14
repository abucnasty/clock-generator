import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { CHECK_TEXT, type CheckStatus } from '../utils/checkThenGenerate';
import { TransferPlanPanel } from './TransferPlanPanel';

interface CheckPlanSectionProps {
    validation: ValidationState;
    checkStatus: CheckStatus;
    /** A check or a generation is running */
    busy: boolean;
    onCheckOnly: () => void;
    excludedIngredients: string[];
    onExcludeChange: (items: string[]) => void;
}

const formatTicks = (ticks: number) => Number.isInteger(ticks) ? `${ticks}` : ticks.toFixed(3);

/**
 * The swing plan of the last check, in Advanced Overrides: how many swings each inserter makes per crafting cycle, and
 * which ingredients are left out of the LCM. Any check makes it, Generate's or Check only's; an edit since dims it.
 */
export function CheckPlanSection({
    validation,
    checkStatus,
    busy,
    onCheckOnly,
    excludedIngredients,
    onExcludeChange,
}: CheckPlanSectionProps) {
    if (checkStatus === 'running') {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} color="inherit" />
                <Typography variant="body2">{CHECK_TEXT.checking}</Typography>
            </Box>
        );
    }
    if (checkStatus === 'invalid') {
        return <Typography variant="body2" color="text.secondary">{CHECK_TEXT.planFailed}</Typography>;
    }
    if (validation.status !== 'valid') {
        // never checked, the build was replaced, or a failed check is out of date: there is no plan to show
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">{CHECK_TEXT.planEmpty}</Typography>
                <Button variant="text" size="small" onClick={onCheckOnly} disabled={busy}>
                    {CHECK_TEXT.checkOnly}
                </Button>
            </Box>
        );
    }
    const isOutOfDate = checkStatus === 'out-of-date';
    const plan = validation.validation;
    return (
        <>
            {isOutOfDate && (
                // not an alert: it follows every edit, and is not news to read out
                <Alert severity="warning" role="none" sx={{ mb: 1 }}>{CHECK_TEXT.planOutOfDate}</Alert>
            )}
            {/* the plan's table is wider than a phone: it scrolls on its own, not the page */}
            <Box inert={isOutOfDate} sx={{ opacity: isOutOfDate ? 0.45 : 1, pointerEvents: isOutOfDate ? 'none' : 'auto', overflowX: 'auto' }}>
                {!isOutOfDate && (
                    // not an alert: the check's result is read out once, from the workflow bar
                    <Alert severity="success" role="none" sx={{ mb: 1 }}>
                        Each output inserter takes {plan.output_swings_per_cycle} swing
                        {plan.output_swings_per_cycle === 1 ? '' : 's'} per crafting cycle of{' '}
                        {formatTicks(plan.cycle_ticks)} ticks, and the clock repeats every{' '}
                        {formatTicks(plan.period_ticks)} ticks ({plan.used_lcm} cycle
                        {plan.used_lcm === 1 ? '' : 's'}). A generation may still lower the output swings
                        if this count turns out unstable.
                    </Alert>
                )}
                <TransferPlanPanel
                    transferPlan={plan.transfer_plan}
                    usedLcm={plan.used_lcm}
                    excludedIngredients={excludedIngredients}
                    onExcludeChange={onExcludeChange}
                />
            </Box>
        </>
    );
}
