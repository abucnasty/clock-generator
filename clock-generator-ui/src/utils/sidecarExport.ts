/**
 * What text pasted or opened as a file holds, read before the engine checks its entities: an export of the Clock
 * Generator Sidecar mod, or the reason it is not one. Only the shape is read here; the engine checks each entry.
 */

/** Why the text is not an export the paste can use */
export type SidecarExportProblem = 'empty' | 'not-json' | 'not-an-export' | 'build-file' | 'no-entities';

export interface PickupCaptureWarning {
    inserter_id: number;
    reason: 'bend' | 'splitter' | 'inline' | 'unsupported' | 'merge' | 'supply-unknown';
}

interface SidecarExport {
    kind: 'export';
    /** The first exports were a bare array of machines: only the machines are offered */
    legacy: boolean;
    machines: unknown[];
    drills: unknown[];
    miningProductivityLevel?: number;
    inserters: unknown[];
    belts: unknown[];
    chests: unknown[];
    sidecarVersion: unknown;
    suggestedTarget: unknown;
    pickupWarnings?: PickupCaptureWarning[];
}

type SidecarExportRead = SidecarExport | { kind: 'problem'; problem: SidecarExportProblem };

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
}

/** A build file saved by this site has a target output; an export of the mod never does */
const isBuildFile = (value: unknown) => isObject(value) && 'target_output' in value;

export function readSidecarExport(text: string): SidecarExportRead {
    if (text.trim() === '') {
        return { kind: 'problem', problem: 'empty' };
    }
    const parsed = parse(text);
    if (!parsed.ok) {
        return { kind: 'problem', problem: 'not-json' };
    }
    const value = parsed.value;
    if (isBuildFile(value)) {
        return { kind: 'problem', problem: 'build-file' };
    }
    if (isObject(value) && 'machines' in value) {
        // drills are { mining_productivity_level, configs }, or a bare list in older exports
        const drills = value.drills;
        const drillConfigs = isObject(drills) ? listOf(drills.configs) : listOf(drills);
        const level = isObject(drills) && typeof drills.mining_productivity_level === 'number' ? drills.mining_productivity_level : undefined;
        const read: SidecarExport = {
            kind: 'export',
            legacy: false,
            machines: listOf(value.machines),
            drills: drillConfigs,
            miningProductivityLevel: level,
            inserters: listOf(value.inserters),
            belts: listOf(value.belts),
            chests: listOf(value.chests),
            sidecarVersion: value.sidecar_version,
            suggestedTarget: value.suggested_target,
        };
        const warnings = listOf(value.pickup_warnings).filter((warning): warning is PickupCaptureWarning =>
            isObject(warning) && typeof warning.inserter_id === 'number' && Number.isSafeInteger(warning.inserter_id)
            && warning.inserter_id > 0 && warning.inserter_id <= read.inserters.length
            && typeof warning.reason === 'string' && ['bend', 'splitter', 'inline', 'unsupported', 'merge', 'supply-unknown'].includes(warning.reason));
        if (warnings.length) read.pickupWarnings = warnings;
        const total = read.machines.length + read.drills.length + read.inserters.length + read.belts.length + read.chests.length;
        return total === 0 ? { kind: 'problem', problem: 'no-entities' } : read;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return { kind: 'problem', problem: 'no-entities' };
        }
        return {
            kind: 'export',
            legacy: true,
            machines: value,
            drills: [],
            inserters: [],
            belts: [],
            chests: [],
            sidecarVersion: undefined,
            suggestedTarget: undefined,
        };
    }
    return { kind: 'problem', problem: 'not-an-export' };
}

/** Whether a file that was opened is an export of the mod rather than a build file, so it goes to the paste instead */
export function looksLikeSidecarExport(text: string): boolean {
    const parsed = parse(text);
    if (!parsed.ok) {
        return false;
    }
    return Array.isArray(parsed.value) || (isObject(parsed.value) && 'machines' in parsed.value && !isBuildFile(parsed.value));
}

/** Capture warnings describe geometry or local supply independently. */
export function pickupCaptureWarningMessage(reason: PickupCaptureWarning['reason']): string {
    if (reason === 'merge') return 'This merge is outside the supported turbo two-stream side-feed model. Review its speed, streams and downstream path before generating a clock.';
    if (reason === 'supply-unknown') return 'Sidecar could not establish a single, same-speed side feed. Supply entry is unspecified; review the connected inputs before generating a clock.';
    const detail = reason === 'bend' ? 'pickup is on a belt bend'
        : reason === 'splitter' ? 'pickup is on a splitter'
        : reason === 'inline' ? 'pickup is in line with the belt, rather than beside it'
        : 'pickup geometry is unsupported';
    return `${detail}. Sidecar left its pickup type unspecified; this geometry has not been calibrated.`;
}
