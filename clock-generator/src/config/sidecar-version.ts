import { FactorioDataService } from "../data/factorio-data-service";
import { Option } from "../data-types/option";
import { ImportInput, ImportedMachine, ImportPipeline, ImportStep } from "./import-pipeline";

/**
 * The newest version of the sidecar mod. The sidecar always has the same version as the rest of the project
 * (see "Versioning" in the README), so this is bumped with every release, whether or not the mod changed.
 */
export const LATEST_SIDECAR_VERSION = "0.6.0";

/** The first version of the sidecar mod that exports the energy consumption of biochambers. */
export const SIDECAR_VERSION_WITH_ENERGY_CONSUMPTION = "0.6.0";

/** Negative when a is older than b, positive when it is newer, 0 when they are the same. */
export function compareVersions(a: string, b: string): number {
    const parts = (version: string) => version.split(".").map(part => Number.parseInt(part, 10) || 0);
    const left = parts(a);
    const right = parts(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

export function sidecarVersionOf(sidecar_version: unknown): string | null {
    return typeof sidecar_version === "string" && sidecar_version.length > 0 ? sidecar_version : null;
}

/** True for a sidecar that did not say its version (before it exported one) or has an older one than `version` */
function isOlderThan(sidecar_version: string | null, version: string): boolean {
    return sidecar_version === null || compareVersions(sidecar_version, version) < 0;
}

function exportedBy(sidecar_version: string | null): string {
    return sidecar_version ? `Clock Generator Sidecar ${sidecar_version}` : "an older Clock Generator Sidecar";
}

/**
 * A feature of the config that the sidecar only exports from a version on. Without it the user has to set the
 * feature by hand, so the step has a message about it when the data comes from an older sidecar and has something
 * the feature is for.
 */
export interface SidecarFeature {
    readonly name: string;
    /** The first version of the sidecar that exports it */
    readonly since: string;
    /** Whether anything in the data needs it */
    readonly appliesTo: (input: ImportInput) => boolean;
    /** What the user is missing and what to do about it without updating, as a sentence. */
    readonly missing: (input: ImportInput) => string;
}

export function sidecarFeatureStep(feature: SidecarFeature): ImportStep {
    return input => {
        if (!isOlderThan(input.sidecar_version, feature.since) || !feature.appliesTo(input)) {
            return Option.none();
        }
        return Option.some(feature.missing(input));
    };
}

/** Biochambers before 0.6.0 were exported as plain machines, so they are told apart by their recipe. */
function maybeBiochamber(machine: ImportedMachine): boolean {
    if (machine.type === "biochamber") {
        return true;
    }
    if (!FactorioDataService.isInitialized()) {
        return true;
    }
    try {
        const category = FactorioDataService.findRecipeOrThrow(machine.recipe).category;
        return category === "organic" || category === "organic-or-assembling";
    } catch {
        return false;
    }
}

export const ENERGY_CONSUMPTION_FEATURE: SidecarFeature = {
    name: "energy-consumption",
    since: SIDECAR_VERSION_WITH_ENERGY_CONSUMPTION,
    appliesTo: input => input.machines.some(maybeBiochamber),
    missing: () => "The energy consumption of biochambers is not exported, so it has to be set on each biochamber by hand.",
};

/** Every feature the sidecar added to what it exports, oldest first. Add the next one here. */
export const SIDECAR_FEATURES: readonly SidecarFeature[] = [ENERGY_CONSUMPTION_FEATURE];

/** Tells that there is a newer sidecar when nothing more specific was said about what an older one lacks */
export const newerSidecarStep: ImportStep = input =>
    isOlderThan(input.sidecar_version, LATEST_SIDECAR_VERSION)
        ? Option.some("Nothing in this import is affected by that.")
        : Option.none();

/** What is checked on data pasted from the sidecar mod: what an older mod lacks, else that there is a newer one */
export const SIDECAR_IMPORT_PIPELINE: ImportPipeline = ImportPipeline
    .of(...SIDECAR_FEATURES.map(sidecarFeatureStep))
    .otherwise(newerSidecarStep);

/**
 * The guidance for data pasted from the sidecar mod, None when there is nothing to tell. The messages of the steps
 * are folded into one that says which version exported the data and, once, to update the mod to get everything.
 */
export function checkSidecarImport(
    sidecar_version: unknown,
    machines: readonly ImportedMachine[],
    pipeline: ImportPipeline = SIDECAR_IMPORT_PIPELINE,
): Option<string> {
    const version = sidecarVersionOf(sidecar_version);
    return Option.map(
        pipeline.run({ sidecar_version: version, machines }),
        missing => `This was exported by ${exportedBy(version)}. ${missing} Update the mod to ${LATEST_SIDECAR_VERSION} to import everything automatically.`,
    );
}
