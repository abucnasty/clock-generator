/**
 * What text pasted or opened as a file holds, read before the engine checks its entities: an export of the Clock
 * Generator Sidecar mod, or the reason it is not one. Only the shape is read here; the engine checks each entry.
 */

/** Why the text is not an export the paste can use */
export type SidecarExportProblem = 'empty' | 'not-json' | 'not-an-export' | 'build-file' | 'no-entities';

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
