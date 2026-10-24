import { Alert, Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import type { ConfigValidation } from 'clock-generator/browser';
import { useState } from 'react';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { CHECK_TEXT, type CheckStatus } from '../utils/checkThenGenerate';
import { ELEMENT_IDS, type Problem } from '../utils/firstProblem';
import { HANDS_TEXT } from '../utils/targetCounts';
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
 * The swing plan of the last check, in Advanced: how many swings each inserter makes per crafting cycle, and
 * which ingredients are left out of the LCM. Any check makes it, Generate's or Check only's; an edit since makes it read-only.
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
    // An Exclude edit reaches the worker through App's effect. Keep the same guarded chip through that gap.
    const [pendingValidation, setPendingValidation] = useState<ValidationState | null>(null);
    if (pendingValidation && (pendingValidation !== validation || checkStatus === 'valid')) {
        setPendingValidation(null);
    }
    const running = checkStatus === 'running'
        || (pendingValidation === validation && checkStatus === 'out-of-date');
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
    // The last plan stays readable while checking; the same chip keeps focus and cannot change the plan.
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
            {/* Old values remain available to read and scroll; only planning mutations are blocked. */}
            <Box aria-busy={running || undefined}>
                {!isOutOfDate && (
                    // not an alert: the check's result is read out once, from the workflow bar
                    <Alert severity="success" role="none" sx={{ mb: 1 }}>
                        {plan.counts === 'destroyed'
                            ? HANDS_TEXT.plan(plan.output_swings_per_cycle, formatTicks(plan.cycle_ticks))
                            : <>
                                Each output machine has {plan.output_swings_per_cycle} total output swing
                                {plan.output_swings_per_cycle === 1 ? '' : 's'} per crafting cycle of{' '}
                                {formatTicks(plan.cycle_ticks)} ticks, shared equally across its output inserters</>}
                        , and the clock {plan.used_lcm === 1 ? 'period is' : 'repeats every'}{' '}
                        {formatTicks(plan.period_ticks)} ticks ({plan.used_lcm} crafting
                        cycle{plan.used_lcm === 1 ? '' : 's'}). Generating may still use fewer {plan.counts === 'destroyed' ? 'hands' : 'swings'}{' '}
                        if this count does not hold the rate.
                    </Alert>
                )}
                <TransferPlanPanel
                    interaction={running ? 'checking' : isOutOfDate ? 'read-only' : 'editable'}
                    transferPlan={plan.transfer_plan}
                    usedLcm={plan.used_lcm}
                    excludedIngredients={excludedIngredients}
                    onExcludeChange={items => {
                        if (checkStatus !== 'valid' || validation.status !== 'valid') return;
                        setPendingValidation(validation);
                        onExcludeChange(items);
                    }}
                />
            </Box>
        </>
    );
}
