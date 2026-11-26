/**
 * What a generation knows of the repetition in its build before any clock is planned: the repeated groups of machines the region
 * finder finds (`regionOrbitsOfConfig`), and whether the build is copies written out one by one that the conversion can make one
 * unit with `copies` of (`planRepeatedUnitConversion`). It is found once, before planning, and every planner reads it from here:
 * the generation runs inside `withBuildRegions`, and a task the site runs in a worker gets it in its context (plain data).
 */
import type { Config } from "../../config";
import { planRepeatedUnitConversion, type RepeatedUnitConversionReasonCode } from "../../config/repeated-unit-conversion";
import { regionOrbitsOfConfig, type FoundOrbit, type RegionOrbit } from "./regions";

export interface BuildRegions {
    /** The orbits of repeated groups of machines, refused ones with their code; null where the build has none */
    orbits: FoundOrbit[] | null;
    /** Whether the copies conversion can make the build one unit with `copies`: "available", else the code that refuses it */
    copies_conversion: "available" | RepeatedUnitConversionReasonCode;
}

/** The detection of a build, made once a call: the finder, then the copies conversion */
export function buildRegionsOf(config: Config): BuildRegions {
    const orbits = regionOrbitsOfConfig(config);
    let copies_conversion: BuildRegions["copies_conversion"];
    try {
        const conversion = planRepeatedUnitConversion(config);
        copies_conversion = conversion.kind === "available" ? "available" : conversion.reason.code;
    } catch {
        copies_conversion = "invalid-config";
    }
    return { orbits, copies_conversion };
}

/** The first orbit the build has that is not refused, or null */
export function firstOrbitOf(regions: BuildRegions | undefined): RegionOrbit | null {
    const found = regions?.orbits?.find(it => it.kind === "orbit");
    return found?.kind === "orbit" ? found.orbit : null;
}

let current: BuildRegions | undefined;

/** Runs a generation with the detection of its build; a generation inside it (a cut region's) runs with its own, and the outer one comes back */
export function withBuildRegions<T>(regions: BuildRegions, generate: () => T): T {
    const outer = current;
    current = regions;
    try {
        return generate();
    } finally {
        current = outer;
    }
}

/** The detection of the build being generated (`withBuildRegions`); undefined outside a generation */
export function currentBuildRegions(): BuildRegions | undefined {
    return current;
}
