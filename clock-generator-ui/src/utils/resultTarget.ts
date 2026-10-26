import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from './configForm/formData';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { entityOptionsOf, type EntityOption } from './inserterOptions';

/** The direct output target field of a machine that places its results itself: every text in one place */
export const RESULT_TARGET_TEXT = {
    label: 'Direct output target',
    /** The empty choice describes the physical receiver, without promising to disable ejection. */
    none: 'No direct receiver (ground)',
    helpLabel: 'About direct output targets',
    help: 'Select the machine or container at the recycler’s output. A machine receives the results its recipe uses. Other results remain available to inserters. Choose “No direct receiver (ground)” when no machine or container is at the output.',
} as const;

/** The accessible name of the field of one machine: "Direct output target, Machine 1" */
export const resultTargetName = (machineLabel: string) => `${RESULT_TARGET_TEXT.label}, ${machineLabel}`;

/** The parts of the build the direct output target picker names and infers a container's items from */
export interface ResultTargetBuild {
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    inserters: InserterFormData[];
    drills: readonly DrillFormData[];
}

/** A choice of the direct output target picker: a container of the build */
export interface ResultTargetOption extends EntityOption {
    type: 'chest' | 'machine';
}

/** What a machine can put its results into: the build's containers (chests, cars, tanks, cargo wagons, rocket silos), named as the drill Target picker names them */
export function resultTargetOptions(
    build: ResultTargetBuild,
    labels: { recipe: (id: string) => string; item: (id: string) => string },
    getRecipeInfo?: (name: string) => RecipeInfo | null,
): ResultTargetOption[] {
    return entityOptionsOf(build.machines, build.belts, build.chests, labels, { inserters: build.inserters, getRecipeInfo, drills: build.drills })
        .flatMap(option => option.type === 'chest' || option.type === 'machine' ? [{ ...option, type: option.type }] : []);
}
