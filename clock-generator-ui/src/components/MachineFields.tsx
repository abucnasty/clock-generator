import { InfoOutlined } from '@mui/icons-material';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useCraftingMachines } from '../hooks/useCraftingMachines';
import { useGameNames } from '../hooks/useGameNames';
import type { MachineFormData } from '../utils/configForm/formData';
import {
    craftingMachineOf, effectiveRule, MACHINE_QUALITIES, MACHINE_QUALITY_HELP, prototypeSourceText, qualityLabel, ruleDescription,
    ruleOfMachine, RULE_LABELS, type MachineRule,
} from '../utils/machinePrototype';
import { EntityTypeField } from './EntityFields';
import { HelpButton } from './HelpButton';
import { MachineIcon } from './MachineIcon';
import { QualityPip } from './QualityBadge';

type Patch = (patch: Partial<MachineFormData>) => void;

/** The value of the Machine picker for a row without a machine */
const NO_MACHINE = '';

/**
 * The machine a row is: a crafting machine of the game data, set by Sidecar or chosen here. Choosing one sets the
 * simulation rule its data gives; choosing none keeps the rule as it was, to be set by hand.
 */
export function MachinePrototypeField({ machine, onPatch, inputAriaLabel, sx }: {
    machine: MachineFormData; onPatch: Patch; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    const data = useCraftingMachines();
    const { itemLabel } = useGameNames();
    // a machine the data does not hold (a mod's) stays an option, so the row keeps showing it
    const names = [...data.machines.map(it => it.name), ...(machine.prototype && !craftingMachineOf(data, machine.prototype) ? [machine.prototype] : [])];
    const choose = (name: string) => {
        if (name === NO_MACHINE) {
            onPatch({ prototype: undefined, _prototype_source: undefined, type: effectiveRule(machine, data) });
            return;
        }
        const chosen = craftingMachineOf(data, name);
        onPatch({ prototype: name, _prototype_source: 'hand', ...(chosen && { type: ruleOfMachine(chosen) }) });
    };
    const shown = (name: string) => name === NO_MACHINE
        ? <Typography variant="body2" component="span" color="text.secondary">None: set the rule by hand</Typography>
        : <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <MachineIcon machine={{ prototype: name, quality: machine.quality }} size={20} />
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemLabel(name)}</Box>
        </Box>;
    return <Tooltip title={machine.prototype ? `${itemLabel(machine.prototype)}, ${prototypeSourceText(machine._prototype_source)}` : ''} describeChild placement="top">
        <FormControl size="small" sx={sx}>
            <InputLabel shrink>Machine</InputLabel>
            <Select value={machine.prototype ?? NO_MACHINE} label="Machine" notched displayEmpty renderValue={shown}
                inputProps={{ 'aria-label': inputAriaLabel }} onChange={event => choose(event.target.value)}>
                <MenuItem value={NO_MACHINE}>{shown(NO_MACHINE)}</MenuItem>
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

/**
 * How the row is simulated. With a machine of the game data the rule is its machine's, shown on one line with what it
 * does; a config whose type says otherwise keeps its type, says so, and offers the machine's rule. Without a machine the
 * rule is chosen here.
 */
export function MachineRuleField({ machine, onPatch, blockedAt, inputAriaLabel, sx }: {
    machine: MachineFormData; onPatch: Patch; blockedAt?: string; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    const data = useCraftingMachines();
    const { itemLabel } = useGameNames();
    const rule = effectiveRule(machine, data);
    const known = craftingMachineOf(data, machine.prototype);
    if (!known) {
        return <Tooltip title={ruleDescription(rule, blockedAt)} describeChild placement="top">
            <Box sx={sx}>
                <EntityTypeField label="Simulation rule" value={rule} options={RULE_OPTIONS} nameOf={value => RULE_LABELS[value]} icons={false}
                    inputAriaLabel={inputAriaLabel} sx={{ width: '100%' }} onChange={value => onPatch({ type: value })} />
            </Box>
        </Tooltip>;
    }
    const derived = ruleOfMachine(known);
    return <Box sx={[{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <Tooltip title={ruleDescription(rule, blockedAt)} describeChild placement="top">
            <Typography variant="body2" tabIndex={0} aria-label={`${inputAriaLabel}: ${RULE_LABELS[rule]}`}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, overflowWrap: 'anywhere' }}>
                Simulation rule: {RULE_LABELS[rule]}{rule === derived ? `, from the ${itemLabel(known.name)}` : ''}
                <InfoOutlined sx={{ fontSize: 16, color: 'text.secondary' }} aria-hidden />
            </Typography>
        </Tooltip>
        {rule !== derived && <>
            <Typography variant="body2" color="warning.main">
                The config's type sets it; a {itemLabel(known.name)} crafts under the {RULE_LABELS[derived].toLowerCase()}.
            </Typography>
            <Button size="small" color="inherit" onClick={() => onPatch({ type: derived })}>Use the {RULE_LABELS[derived].toLowerCase()}</Button>
        </>}
    </Box>;
}

const RULE_OPTIONS: readonly { value: MachineRule }[] = [{ value: 'machine' }, { value: 'furnace' }, { value: 'biochamber' }];
