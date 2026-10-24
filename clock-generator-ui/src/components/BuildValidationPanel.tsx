import { Box, Button, Typography } from '@mui/material';
import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import type { ChestType } from 'clock-generator/light';
import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RepeatedUnitsRecovery } from '../worker/types';
import type { BuildValidationIssue } from '../utils/buildValidation';
import type { TargetCounts } from '../utils/targetCounts';
import type { FocusTarget } from '../utils/firstProblem';
import { CheckErrorAlert } from './CheckErrorAlert';
import { MissingInserterAlert } from './MissingInserterAlert';
import { OutputChestAlert } from './OutputChestAlert';
import { ValidationPanel } from './ValidationPanel';

export function BuildValidationPanel({ issues, machines, belts, chests, inserters, onApplyFix, fixUnavailable,
    onSwitchType, onEnableRemoval, onReview, recovery, conversionPending, onConvert, counts, focusTargets = true }: {
    issues: BuildValidationIssue[];
    machines: MachineFormData[]; belts: BeltFormData[]; chests: ChestFormData[]; inserters: InserterFormData[];
    onApplyFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
    fixUnavailable?: (fix: InserterFixOption, issue: InserterCoverageIssue) => string | null;
    onSwitchType: (index: number, type: ChestType, disposal?: boolean) => void;
    onEnableRemoval: (index: number) => void;
    onReview: (target: FocusTarget) => void;
    recovery?: RepeatedUnitsRecovery; conversionPending?: boolean; onConvert?: () => void;
    /** What the target counts, which the engine's words about the machines' capacity follow */
    counts?: TargetCounts;
    focusTargets?: boolean;
}) {
    return <ValidationPanel issues={issues} focusTargets={focusTargets}>{issue => issue.chest ? <OutputChestAlert embedded focusTargets={false} chests={[issue.chest.chest]} inserters={inserters}
                    onSwitchType={(_index, type, disposal) => onSwitchType(issue.chest!.index, type, disposal)}
                    onEnableRemoval={() => onEnableRemoval(issue.chest!.index)} />
                    : issue.coverage ? <>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{issue.text}</Typography>
                        <MissingInserterAlert embedded focusTargets={false} issues={[issue.coverage]} machines={machines} belts={belts} chests={chests}
                            onApplyFix={onApplyFix} fixUnavailable={fixUnavailable} />
                    </> : issue.source === 'engine' ? <CheckErrorAlert embedded message={issue.text} recovery={recovery} counts={counts}
                        machineCount={machines.length} conversionPending={conversionPending} onConvert={onConvert} />
                        : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="body2">{issue.text}</Typography>
                            {issue.fieldTarget && <Button size="small" color="inherit" variant="outlined" onClick={() => onReview(issue.fieldTarget!)}>Review setting</Button>}
                        </Box>}
    </ValidationPanel>;
}
