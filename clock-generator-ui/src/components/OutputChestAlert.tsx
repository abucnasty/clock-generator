import { AlertTitle, Box, Button, Typography } from '@mui/material';
import { ChestType } from 'clock-generator/light';
import type { ChestFormData, InserterFormData } from '../hooks/useConfigForm';
import { outputChestIssues, outputChestIssueTitle, type OutputChestIssue } from '../utils/outputChestIssues';
import { isBufferChest } from '../utils/configForm/formData';
import { entityLabel } from '../utils/entityLabel';
import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { useGameNames } from '../hooks/useGameNames';
import { chestValidationIssue } from '../utils/buildValidation';
import { ValidationPanel } from './ValidationPanel';

interface Props {
    chests: ChestFormData[];
    inserters: InserterFormData[];
    onSwitchType: (index: number, type: ChestType, disposal?: boolean) => void;
    onEnableRemoval: (index: number) => void;
    focusTargets?: boolean;
    embedded?: boolean;
}

/** The same warning and repair in list, diagram, fullscreen, and chest drafts. */
export function OutputChestAlert({ chests, inserters, onSwitchType, onEnableRemoval, focusTargets = true, embedded = false }: Props) {
    const { itemLabel } = useGameNames();
    const issues = outputChestIssues(chests, inserters);
    const renderIssue = (issue: OutputChestIssue) => {
        const { chest, index, kind } = issue;
        const content = <>
            <AlertTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box component="span" aria-hidden sx={{ display: 'inline-flex' }}>
                    <EntityBadge id={chest.id} size="small"><FactorioIcon name={isBufferChest(chest) ? 'steel-chest' : 'infinity-chest'} size={22} alt="" /></EntityBadge>
                </Box>
                <span>{outputChestIssueTitle(issue)}</span>
            </AlertTitle>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: '1 1 280px' }}>
                    {isBufferChest(chest)
                        ? `No inserter takes ${chest.item_filter ? itemLabel(chest.item_filter).toLowerCase() : 'items'} out of this buffer chest. The simulator does not empty it, so once it fills up, production can stop. Use an infinity chest with Remove unfiltered items enabled to model output being taken away continuously.`
                        : 'An inserter already delivers to this infinity chest, but it has no filters and Remove unfiltered items is off. Enable it to remove all incoming items and accept output through the existing connection.'}
                </Typography>
                <Button size="small" color="inherit" variant="outlined" aria-label={`${kind === 'finite' ? 'Use infinity chest' : 'Enable Remove unfiltered items'} for ${entityLabel('chest', chest.id)}`}
                    onClick={() => kind === 'finite' ? onSwitchType(index, ChestType.INFINITY_CHEST, true) : onEnableRemoval(index)}>
                    {kind === 'finite' ? 'Use infinity chest' : 'Enable removal'}
                </Button>
            </Box>
        </>;
        return <Box key={chest.id}>{content}</Box>;
    };
    return embedded ? <>{issues.map(renderIssue)}</> : <ValidationPanel issues={issues.map(chestValidationIssue)} focusTargets={focusTargets}>
        {issue => renderIssue(issue.chest!)}
    </ValidationPanel>;
}
