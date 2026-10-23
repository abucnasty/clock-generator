import { Box, FormControl, InputLabel, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useCraftingMachines } from '../hooks/useCraftingMachines';
import { useGameNames } from '../hooks/useGameNames';
import type { MachineFormData } from '../utils/configForm/formData';
import { craftingMachineOf, MACHINE_QUALITIES, MACHINE_QUALITY_HELP, prototypeSourceText, qualityLabel } from '../utils/machinePrototype';
import { HelpButton } from './HelpButton';
import { MachineIcon } from './MachineIcon';
import { QualityPip } from './QualityBadge';

type Patch = (patch: Partial<MachineFormData>) => void;

/** The value of the Machine picker for a row without a machine */
const NO_MACHINE = '';

/**
 * The machine a row is: a crafting machine of the game data, set by Sidecar, picked for the row's recipe or chosen here;
 * the engine works out how it is simulated from it. A row without one (an older build's) shows "Not set" until one is
 * chosen.
 */
export function MachinePrototypeField({ machine, onPatch, inputAriaLabel, sx }: {
    machine: MachineFormData; onPatch: Patch; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    const data = useCraftingMachines();
    const { itemLabel } = useGameNames();
    // a machine the data does not hold (a mod's) stays an option, so the row keeps showing it
    const names = [...data.machines.map(it => it.name), ...(machine.prototype && !craftingMachineOf(data, machine.prototype) ? [machine.prototype] : [])];
    const shown = (name: string) => name === NO_MACHINE
        ? <Typography variant="body2" component="span" color="text.secondary">Not set</Typography>
        : <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <MachineIcon machine={{ prototype: name, quality: machine.quality }} size={20} />
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemLabel(name)}</Box>
        </Box>;
    return <Tooltip title={machine.prototype ? `${itemLabel(machine.prototype)}, ${prototypeSourceText(machine._prototype_source)}` : ''} describeChild placement="top">
        <FormControl size="small" sx={sx}>
            <InputLabel shrink>Machine</InputLabel>
            <Select value={machine.prototype ?? NO_MACHINE} label="Machine" notched displayEmpty renderValue={shown}
                inputProps={{ 'aria-label': inputAriaLabel }} onChange={event => onPatch({ prototype: event.target.value, _prototype_source: 'hand' })}>
                {names.map(name => <MenuItem key={name} value={name}>{shown(name)}</MenuItem>)}
            </Select>
        </FormControl>
    </Tooltip>;
}

/** The machine's quality, a label only: the game's pip on its icon. Its help says it changes neither speed nor clock. */
export function MachineQualityField({ machine, onPatch, inputAriaLabel, sx }: {
    machine: MachineFormData; onPatch: Patch; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    const shown = (quality: string) => quality === ''
        ? <Typography variant="body2" component="span" color="text.secondary">Not set</Typography>
        : <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <QualityPip quality={quality} size={16} />
            {qualityLabel(quality as typeof MACHINE_QUALITIES[number])}
        </Box>;
    return <Box sx={[{ display: 'flex', alignItems: 'center', gap: 0.5 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
            <InputLabel shrink>Quality</InputLabel>
            <Select value={machine.quality ?? ''} label="Quality" notched displayEmpty renderValue={shown}
                inputProps={{ 'aria-label': inputAriaLabel }}
                onChange={event => { const value: string = event.target.value; onPatch({ quality: value === '' ? undefined : value as MachineFormData['quality'] }); }}>
                <MenuItem value="">{shown('')}</MenuItem>
                {MACHINE_QUALITIES.map(quality => <MenuItem key={quality} value={quality}>{shown(quality)}</MenuItem>)}
            </Select>
        </FormControl>
        <HelpButton label="About machine quality"><Typography variant="body2">{MACHINE_QUALITY_HELP}</Typography></HelpButton>
    </Box>;
}
