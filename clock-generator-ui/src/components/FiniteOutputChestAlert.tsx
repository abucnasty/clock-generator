import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';
import { ChestType } from 'clock-generator/light';
import type { ChestFormData, InserterFormData } from '../hooks/useConfigForm';
import { finiteOutputChests } from '../utils/finiteOutputChests';
import { entityLabel } from '../utils/entityLabel';
import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { useGameNames } from '../hooks/useGameNames';

interface Props {
    chests: ChestFormData[];
    inserters: InserterFormData[];
    onSwitchType: (index: number, type: ChestType) => void;
}

/** The same warning and repair in list, diagram, fullscreen, and chest drafts. */
export function FiniteOutputChestAlert({ chests, inserters, onSwitchType }: Props) {
    const { itemLabel } = useGameNames();
    return <>{finiteOutputChests(chests, inserters).map(({ chest, index }) => <Alert key={chest.id} severity="warning" sx={{ mb: 2 }}>
        <AlertTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="span" aria-hidden sx={{ display: 'inline-flex' }}>
                <EntityBadge id={chest.id} size="small"><FactorioIcon name="steel-chest" size={22} alt="" /></EntityBadge>
            </Box>
            <span>{entityLabel('chest', chest.id)} can fill up and block output</span>
        </AlertTitle>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Typography variant="body2" sx={{ flex: '1 1 280px' }}>
                {`No inserter takes ${chest.item_filter ? itemLabel(chest.item_filter).toLowerCase() : 'items'} out of this buffer chest.`} The simulator does not empty it, so once it fills up, production can stop.
                {' '}Use an infinity chest to model output being taken away continuously.
            </Typography>
            <Button size="small" color="inherit" variant="outlined" aria-label={`Use infinity chest for ${entityLabel('chest', chest.id)}`}
                onClick={() => onSwitchType(index, ChestType.INFINITY_CHEST)}>Use infinity chest</Button>
        </Box>
    </Alert>)}</>;
}
