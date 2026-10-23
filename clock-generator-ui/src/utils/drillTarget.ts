import { EnableControlMode } from 'clock-generator/light';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from './configForm/formData';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { ENABLE_MODE_LABELS } from './enableRuleLabel';
import { entityOptionsOf, type EntityOption } from './inserterOptions';

/** A choice of the drill Target picker: a machine or a container, and why it cannot be picked now, if it cannot */
interface DrillTargetOption extends EntityOption {
    type: DrillFormData['target']['type'];
    disabledReason?: string;
}

/**
 * The modes a drill that drops into a container cannot have (the config schema's rule): a condition reads an inserter's
 * hand, and a drill that never runs fills nothing
 */
const NOT_INTO_A_CONTAINER: readonly EnableControlMode[] = [EnableControlMode.CONDITIONAL, EnableControlMode.NEVER];

/** Why a container cannot be picked for a drill with this rule */
const CONTAINER_NEEDS = (mode: EnableControlMode) => `Its rule is ${ENABLE_MODE_LABELS[mode]}; a drill into a container needs ${
    [EnableControlMode.AUTO, EnableControlMode.CLOCKED, EnableControlMode.ALWAYS].map(m => ENABLE_MODE_LABELS[m]).join(', ')}`;

/** Whether a drill with this rule may drop into a container: Auto (or none), Clocked and Always may */
export function ruleAllowsContainer(drill: Pick<DrillFormData, 'overrides'>): boolean {
    const mode = drill.overrides?.enable_control?.mode;
    return mode === undefined || !NOT_INTO_A_CONTAINER.includes(mode);
}

/** The parts of the build the Target picker names and infers a container's items from */
export interface DrillTargetBuild {
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    inserters: InserterFormData[];
    drills: readonly DrillFormData[];
}

/**
 * What a drill can drop into: the build's machines, then its containers (chests, cars, tanks, cargo wagons, rocket
 * silos), named and drawn as the inserters' Source and Destination pickers draw them, each container with what it
 * holds. A container is not offered to a drill whose rule a drill into a container cannot have; the drill's current
 * target is always offered, so that the picker shows it.
 */
export function drillTargetOptions(
    drill: Pick<DrillFormData, 'target' | 'overrides'>,
    build: DrillTargetBuild,
    labels: { recipe: (id: string) => string; item: (id: string) => string },
    getRecipeInfo?: (name: string) => RecipeInfo | null,
): DrillTargetOption[] {
    const mode = drill.overrides?.enable_control?.mode;
    const blocked = ruleAllowsContainer(drill) || mode === undefined ? undefined : CONTAINER_NEEDS(mode);
    return entityOptionsOf(build.machines, build.belts, build.chests, labels, { inserters: build.inserters, getRecipeInfo, drills: build.drills })
        .flatMap(option => option.type === 'machine' || option.type === 'chest' ? [{ ...option, type: option.type }] : [])
        .map(option => option.type === 'chest' && blocked && !(drill.target.type === 'chest' && drill.target.id === option.id)
            ? { ...option, disabledReason: blocked } : option);
}
