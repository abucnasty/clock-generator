import { WarningAmber } from '@mui/icons-material';
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useCraftingMachines } from '../hooks/useCraftingMachines';
import { useGameNames } from '../hooks/useGameNames';
import type { MachineFormData } from '../utils/configForm/formData';
import { craftingMachineOf, craftingSpeedHint, MACHINE_QUALITY_HELP, machineChoicePatch, machineSpeedText, prototypeSourceText, recipeNotMadeText } from '../utils/machinePrototype';
import { FilterItemPicker } from './FilterItemPicker';
import { HelpButton } from './HelpButton';
import { ItemPickerField } from './ItemPickerField';
import { MachineIcon } from './MachineIcon';
import { QualityField } from './QualityBadge';

type Patch = (patch: Partial<MachineFormData>) => void;

/**
 * The Machine picker's choices for a row: the crafting machines of the game data (a machine the data does not hold, a
 * mod's, stays one, so the row keeps showing it), and the line the picker puts under each, its crafting speed at the
 * row's quality
 */
function useMachineChoices(machine: Pick<MachineFormData, 'prototype' | 'quality'>) {
    const data = useCraftingMachines();
    const names = useMemo(() => [...data.machines.map(it => it.name), ...(machine.prototype && !craftingMachineOf(data, machine.prototype) ? [machine.prototype] : [])],
        [data, machine.prototype]);
    const detailOf = useCallback((name: string) => {
        const info = craftingMachineOf(data, name);
        return info && machineSpeedText(info, machine.quality);
    }, [data, machine.quality]);
    return { names, detailOf, data };
}

/**
 * The machine a row is: a crafting machine of the game data, set by Sidecar, picked for the row's recipe or chosen here
 * in the picker the recipe has (groups, search, an icon grid); the engine works out how it is simulated from it. A row
 * without one (an older build's) shows no machine until one is chosen.
 */
export function MachinePrototypeField({ machine, onPatch, inputAriaLabel, sx }: {
    machine: MachineFormData; onPatch: Patch; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    const { itemLabel } = useGameNames();
    const { names, detailOf, data } = useMachineChoices(machine);
    return <Tooltip title={machine.prototype ? `${itemLabel(machine.prototype)}, ${prototypeSourceText(machine._prototype_source)}` : ''} describeChild placement="top">
        <Box sx={[{ display: 'flex', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
            <ItemPickerField kind="machine" label="Machine" inputAriaLabel={inputAriaLabel} value={machine.prototype ?? null} options={names} detailOf={detailOf}
                icon={machine.prototype ? <MachineIcon machine={machine} size={20} /> : undefined}
                onChange={value => { if (value) onPatch(machineChoicePatch(value, machine, data)); }} />
        </Box>
    </Tooltip>;
}

/**
 * A row's machine icon as the button that opens the Machine picker, the one the Machine field has: picking a machine
 * there and here is the same
 */
export function MachineIconPicker({ machine, onPatch, buttonName, rowName, children }: {
    machine: MachineFormData; onPatch: Patch; buttonName: string; rowName: string; children: ReactNode;
}) {
    const { names, detailOf, data } = useMachineChoices(machine);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);
    return <>
        <ButtonBase aria-label={buttonName} aria-haspopup="dialog" aria-expanded={anchor !== null} onClick={event => setAnchor(event.currentTarget)}
            sx={{ pointerEvents: 'auto', display: 'inline-flex', borderRadius: 0.5 }}>
            {children}
        </ButtonBase>
        {anchor && <FilterItemPicker anchor={anchor} label={`Choose a machine for ${rowName}`} kind="machine" initialItem={machine.prototype ?? null}
            itemNames={names} detailOf={detailOf} onClose={close} onApply={name => { onPatch(machineChoicePatch(name, machine, data)); close(); }} />}
    </>;
}

/** The hint under the Crafting Speed field: the machine's speed at its quality, and that modules and beacons change it */
export function CraftingSpeedHint({ machine, sx }: { machine: Pick<MachineFormData, 'prototype' | 'quality'>; sx?: SxProps<Theme> }) {
    const data = useCraftingMachines();
    const { itemLabel } = useGameNames();
    return <Typography variant="caption" color="text.secondary" sx={sx}>{craftingSpeedHint(machine, data, itemLabel)}</Typography>;
}

/** What a row says when its machine cannot make its recipe; nothing when it can */
export function RecipeNotMadeNote({ machine, sx }: { machine: Pick<MachineFormData, 'prototype' | 'recipe'>; sx?: SxProps<Theme> }) {
    const data = useCraftingMachines();
    const { itemLabel, recipeLabel } = useGameNames();
    const text = recipeNotMadeText(machine, data, itemLabel, recipeLabel);
    if (text === undefined) return null;
    return <Box sx={[{ display: 'flex', alignItems: 'flex-start', gap: 0.5, color: 'warning.main' }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <WarningAmber fontSize="small" sx={{ flexShrink: 0 }} />
        <Typography variant="caption" sx={{ overflowWrap: 'anywhere', pt: 0.25 }}>{text}</Typography>
    </Box>;
}

/**
 * The machine's quality, a label only: the game's pip on its icon. Its help says it changes neither speed nor clock. A
 * machine without one (an older build's) is Normal, as every entity in the game is unless built otherwise.
 */
export function MachineQualityField({ machine, onPatch, inputAriaLabel, sx }: {
    machine: MachineFormData; onPatch: Patch; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    return <Box sx={[{ display: 'flex', alignItems: 'center', gap: 0.5 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <QualityField value={machine.quality} inputAriaLabel={inputAriaLabel} onChange={quality => onPatch({ quality })} sx={{ flex: 1, minWidth: 0 }} />
        <HelpButton label="About machine quality"><Typography variant="body2">{MACHINE_QUALITY_HELP}</Typography></HelpButton>
    </Box>;
}
