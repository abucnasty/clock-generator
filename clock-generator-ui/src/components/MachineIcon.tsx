import { machineIconName, type MachineFormData } from '../utils/configForm/formData';
import { FactorioIcon } from './FactorioIcon';
import { WithQuality } from './QualityBadge';

/** A machine's icon: its machine (else an assembling machine's) with the quality pip at its bottom-left, as the game draws it */
export function MachineIcon({ machine, size = 28 }: { machine: Pick<MachineFormData, 'prototype' | 'quality'>; size?: number }) {
    return <WithQuality quality={machine.quality} size={size}><FactorioIcon name={machineIconName(machine)} size={size} alt="" /></WithQuality>;
}
