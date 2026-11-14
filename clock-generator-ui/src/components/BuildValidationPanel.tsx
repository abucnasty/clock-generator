import { Box, Button, Typography } from '@mui/material';
import type { InserterCoverageIssue, InserterFixOption, OutputTransferSummary } from 'clock-generator/browser';
import type { ChestType } from 'clock-generator/light';
import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RepeatedUnitsRecovery } from '../worker/types';
import type { BuildValidationIssue } from '../utils/buildValidation';
import type { TargetCounts } from '../utils/targetCounts';
import type { FocusTarget } from '../utils/firstProblem';
import { AdvisoryLine } from './AdvisoryLine';
import { CheckErrorAlert } from './CheckErrorAlert';
import { MissingInserterAlert } from './MissingInserterAlert';
import { OutputChestAlert } from './OutputChestAlert';
import { ValidationPanel } from './ValidationPanel';
import { entityLabel } from '../utils/entityLabel';
import { IMPORTED_AS_ONE_BUILD } from '../utils/pasteText';

export function BuildValidationPanel({ issues, machines, belts, chests, inserters, outputTransfers, onApplyFix, fixUnavailable,
    onSwitchType, onEnableRemoval, onReview, onReviewInserter, recovery, conversionPending, onConvert, counts, focusTargets = true }: {
    issues: BuildValidationIssue[];
    machines: MachineFormData[]; belts: BeltFormData[]; chests: ChestFormData[]; inserters: InserterFormData[];
    outputTransfers?: readonly OutputTransferSummary[] | null;
    onApplyFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
    fixUnavailable?: (fix: InserterFixOption, issue: InserterCoverageIssue) => string | null;
    onSwitchType: (index: number, type: ChestType, disposal?: boolean) => void;
    onEnableRemoval: (index: number) => void;
    onReview: (target: FocusTarget) => void;
    /** Takes the user to the row of an inserter the engine's refusal names */
    onReviewInserter?: (id: number) => void;
    recovery?: RepeatedUnitsRecovery; conversionPending?: boolean; onConvert?: () => void;
    /** What the target counts, which the engine's words about the machines' capacity follow */
    counts?: TargetCounts;
    focusTargets?: boolean;
}) {
    return <ValidationPanel issues={issues} focusTargets={focusTargets}>{issue => issue.advisory
                    ? <AdvisoryLine advisory={issue.advisory} severity={issue.severity} inserters={inserters} machines={machines}
                        onReviewInserter={onReviewInserter} onReviewMachine={id => onReview({ kind: 'machine-recipe', machineId: id })} />
                    : issue.chest ? <OutputChestAlert embedded focusTargets={false} chests={[issue.chest.chest]} inserters={inserters}
                    onSwitchType={(_index, type, disposal) => onSwitchType(issue.chest!.index, type, disposal)}
                    onEnableRemoval={() => onEnableRemoval(issue.chest!.index)} />
                    : issue.coverage ? <>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{issue.text}</Typography>
                        <MissingInserterAlert embedded focusTargets={false} issues={[issue.coverage]} machines={machines} belts={belts} chests={chests}
                            onApplyFix={onApplyFix} fixUnavailable={fixUnavailable} outputTransfers={outputTransfers} onEnableRemoval={onEnableRemoval} />
                    </> : issue.source === 'copies' ? (recovery?.conversion.kind === 'available'
                        // the one copy offered, as Check offered it: the copies found and the step that makes it
                        ? <CheckErrorAlert embedded message={issue.text} recovery={recovery} counts={counts}
                            machineCount={machines.length} conversionPending={conversionPending} onConvert={onConvert} />
                        : <>
                            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{IMPORTED_AS_ONE_BUILD}</Typography>
                            <Typography variant="body2">{issue.text}</Typography>
                        </>)
                    : issue.source === 'engine' ? <>
                        <CheckErrorAlert embedded message={issue.text} recovery={recovery} counts={counts}
                            machineCount={machines.length} conversionPending={conversionPending} onConvert={onConvert} />
                        {/* the inserters the refusal names, each one a step to its row */}
                        {issue.inserters && onReviewInserter && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                            {issue.inserters.map(id => <Button key={id} size="small" color="inherit" variant="outlined" onClick={() => onReviewInserter(id)}>
                                Review {entityLabel('inserter', id).toLowerCase()}</Button>)}
                        </Box>}
                    </>
                        : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="body2">{issue.text}</Typography>
                            {issue.fieldTarget && <Button size="small" color="inherit" variant="outlined" onClick={() => onReview(issue.fieldTarget!)}>Review setting</Button>}
                        </Box>}
    </ValidationPanel>;
}
