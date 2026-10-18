import { FactorioDataService } from "../data/factorio-data-service";
import { Option } from "../data-types/option";
import { ImportInput, ImportedMachine, ImportPipeline, ImportStep } from "./import-pipeline";

/**
 * The newest version of the sidecar mod. The mod has a version of its own (see "Versioning" in the README) and
 * this is bumped with it, when the mod changes: a paste from an older mod is told to update to this version.
 */
export const LATEST_SIDECAR_VERSION = "0.9.1";

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
        return FactorioDataService.findRecipeOrThrow(machine.recipe).categories.includes("organic");
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
export const INFINITY_CHEST_FEATURE: SidecarFeature = {
    name: "infinity-chest-settings", since: "0.8.0",
    appliesTo: input => (input.chests ?? []).some(chest => typeof chest === "object" && chest !== null && "type" in chest && chest.type === "infinity-chest"),
    missing: () => "Infinity chest filters were read from inventory contents and Remove unfiltered items was not exported. Review those chest settings or re-export with the updated mod.",
};
const MOVING_PICKUP_FEATURE: SidecarFeature = {
    name: "moving-belt-pickup", since: "0.9.0",
    appliesTo: input => (input.inserters ?? []).some(inserter => typeof inserter === "object" && inserter !== null
        && "source" in inserter && typeof inserter.source === "object" && inserter.source !== null
        && "type" in inserter.source && inserter.source.type === "belt"),
    missing: () => "The exposed belt pickup length was not exported, so moving pickup timing keeps the older always-full assumption. Re-export to model the reachable stacks.",
};
export const SIDECAR_FEATURES: readonly SidecarFeature[] = [ENERGY_CONSUMPTION_FEATURE, INFINITY_CHEST_FEATURE, MOVING_PICKUP_FEATURE];

/** What `newerSidecarStep` says: an older sidecar exported the data, but it lacks nothing that this data needs */
const NOTHING_MISSING_MESSAGE = "Nothing is missing from this import.";

/** Tells that there is a newer sidecar when nothing more specific was said about what an older one lacks */
export const newerSidecarStep: ImportStep = input =>
    isOlderThan(input.sidecar_version, LATEST_SIDECAR_VERSION)
        ? Option.some(NOTHING_MISSING_MESSAGE)
        : Option.none();

/** What is checked on data pasted from the sidecar mod: what an older mod lacks, else that there is a newer one */
export const SIDECAR_IMPORT_PIPELINE: ImportPipeline = ImportPipeline
    .of(...SIDECAR_FEATURES.map(sidecarFeatureStep))
    .otherwise(newerSidecarStep);

/**
 * The guidance for data pasted from the sidecar mod, None when there is nothing to tell. The messages of the steps
 * are folded into one that says which version exported the data and, once, to update the mod to get everything; when
 * nothing is missing, the update is only offered.
 */
export function checkSidecarImport(
    sidecar_version: unknown,
    machines: readonly ImportedMachine[],
    pipeline: ImportPipeline = SIDECAR_IMPORT_PIPELINE,
    chests: readonly unknown[] = [],
    inserters: readonly unknown[] = [],
): Option<string> {
    const version = sidecarVersionOf(sidecar_version);
    return Option.map(
        pipeline.run({ sidecar_version: version, machines, chests, inserters }),
        missing => {
            const update = missing === NOTHING_MISSING_MESSAGE
                ? `You can update the mod to ${LATEST_SIDECAR_VERSION} when you like.`
                : `Update the mod to ${LATEST_SIDECAR_VERSION} to import everything automatically.`;
            return `This was exported by ${exportedBy(version)}. ${missing} ${update}`;
        },
    );
}
