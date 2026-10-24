import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from './configForm/formData';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { entityOptionsOf, type EntityOption } from './inserterOptions';

/** The Results into field of a machine that places its results itself: every text of it, in one place */
export const RESULT_TARGET_TEXT = {
    label: 'Results into',
    /** The empty choice: no container, the results stay in the machine for inserters to take */
    none: 'Its own output',
    helpLabel: 'About results into',
    help: 'A recycler puts its results straight into the container in front of its output side, if one stands there. '
        + 'Pick that container. With nothing there, the results stay in the recycler for inserters to take.',
} as const;

/** The accessible name of the field of one machine: "Results into, Machine 1" */
export const resultTargetName = (machineLabel: string) => `${RESULT_TARGET_TEXT.label}, ${machineLabel}`;

/** The parts of the build the Results into picker names and infers a container's items from */
export interface ResultTargetBuild {
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    inserters: InserterFormData[];
    drills: readonly DrillFormData[];
}

/** A choice of the Results into picker: a container of the build */
export interface ResultTargetOption extends EntityOption {
    type: 'chest';
}

/** What a machine can put its results into: the build's containers (chests, cars, tanks, cargo wagons, rocket silos), named as the drill Target picker names them */
export function resultTargetOptions(
    build: ResultTargetBuild,
    labels: { recipe: (id: string) => string; item: (id: string) => string },
    getRecipeInfo?: (name: string) => RecipeInfo | null,
): ResultTargetOption[] {
    return entityOptionsOf(build.machines, build.belts, build.chests, labels, { inserters: build.inserters, getRecipeInfo, drills: build.drills })
        .flatMap(option => option.type === 'chest' ? [{ ...option, type: option.type }] : []);
}
