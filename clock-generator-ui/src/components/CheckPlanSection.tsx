import { Alert, Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import type { ConfigValidation } from 'clock-generator/browser';
import { useState } from 'react';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { CHECK_TEXT, type CheckStatus } from '../utils/checkThenGenerate';
import { ELEMENT_IDS, type Problem } from '../utils/firstProblem';
import { TransferPlanPanel } from './TransferPlanPanel';

interface CheckPlanSectionProps {
    validation: ValidationState;
    checkStatus: CheckStatus;
    /** A check or a generation is running */
    busy: boolean;
    onCheckOnly: () => void;
    /** The workflow bar's note: where Check only goes instead of checking; null when it checks */
    note: Problem | null;
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
    note,
    excludedIngredients,
    onExcludeChange,
}: CheckPlanSectionProps) {
    // the plan last shown, kept on screen while a check runs again (an Exclude chip's): the page does not jump and the chip
    // keeps the focus. A replaced build has none
    const current = validation.status === 'valid' ? validation.validation : validation.status === 'none' ? null : undefined;
    const [lastPlan, setLastPlan] = useState<ConfigValidation | null>(current ?? null);
    if (current !== undefined && current !== lastPlan) {
        setLastPlan(current);
    }
    const running = checkStatus === 'running';
    const checkingRow = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CircularProgress size={16} color="inherit" aria-hidden />
            <Typography variant="body2">{CHECK_TEXT.checking}</Typography>
        </Box>
    );
    if (running && !lastPlan) {
        return checkingRow;
    }
    if (checkStatus === 'invalid') {
        return <Typography variant="body2" color="text.secondary">{CHECK_TEXT.planFailed}</Typography>;
    }
    if (!running && validation.status !== 'valid') {
        // never checked, the build was replaced, or a failed check is out of date: there is no plan to show
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">{CHECK_TEXT.planEmpty}</Typography>
                {/* like the bar's Check only: with a problem in the build it says the problem, and goes to the bar's note */}
                <Tooltip title={note?.text ?? CHECK_TEXT.checkOnlyTooltip} arrow describeChild>
                    {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                    <span>
                        <Button
                            variant="text"
                            size="small"
                            onClick={onCheckOnly}
                            disabled={busy}
                            aria-describedby={note ? ELEMENT_IDS.blockReason : undefined}
                        >
                            {CHECK_TEXT.checkOnly}
                        </Button>
                    </span>
                </Tooltip>
            </Box>
        );
    }
    const isOutOfDate = checkStatus === 'out-of-date';
    // while a check runs again, the last plan stays, dimmed: the same elements, so the chip that started it keeps the focus
    const plan = running ? lastPlan : validation.status === 'valid' ? validation.validation : null;
    if (!plan) {
        return null;
    }
    return (
        <>
            {running ? checkingRow : isOutOfDate ? (
                // not an alert: it follows every edit, and is not news to read out
                <Alert severity="warning" role="none" sx={{ mb: 1 }}>{CHECK_TEXT.planOutOfDate}</Alert>
            ) : null}
            {/* the plan's table is wider than a phone: it scrolls on its own, not the page. Dimmed and inert when out of
                date; only dimmed while checked again (a press meanwhile does nothing), so the focus stays on it */}
            <Box
                inert={isOutOfDate}
                aria-busy={running || undefined}
                sx={{ opacity: isOutOfDate || running ? 0.45 : 1, pointerEvents: isOutOfDate || running ? 'none' : 'auto', overflowX: 'auto' }}
            >
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
