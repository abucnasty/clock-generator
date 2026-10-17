import type { EntityClickType } from '../components/ConfigFlowDiagram';
import type { ConfigFormData } from './configForm/formData';
import type { ResultDetail } from './resultsView';
import { serializeConfig } from '../hooks/usePersistedConfigForm';
import { CATEGORY_COLORS, DRILL_STATUS_COLORS, INSERTER_STATUS_COLORS, MACHINE_STATUS_COLORS } from '../components/colors';

export type DetailsTab = 'insights' | 'fuel' | 'blueprint';
export type BuildAnchor = 'configure' | 'target' | 'build' | 'advanced' | 'results' | 'selected-clock' | 'comparison' | 'clock-context' | 'details' | 'developer';
interface BuildEntitySelection { kind: EntityClickType; id: number; signature: string }
export interface TimelineViewContext {
    viewMode: 'simplified' | 'detailed';
    sortMode: 'byType' | 'byRelationship';
    filters: { machine: boolean; inserter: boolean; drill: boolean };
    statuses: { machine: string[]; inserter: string[]; drill: string[]; categories: string[] };
}
export interface BuildViewContext {
    version: 1;
    view: 'configure' | 'results';
    configView: 'list' | 'diagram';
    resultDetail: ResultDetail;
    detailsTab: DetailsTab;
    sections: Record<string, boolean>;
    comparison: { allColumns: boolean; showUnstable: boolean };
    wakeAsTable: boolean;
    diagramDetailed: boolean;
    timeline: TimelineViewContext;
    entity: BuildEntitySelection | null;
    entityConfigKey: string | null;
    position: Partial<Record<'configure' | 'results', { anchor: BuildAnchor; offset: number }>>;
}
const ANCHORS: BuildAnchor[] = ['configure', 'target', 'build', 'advanced', 'results', 'selected-clock', 'comparison', 'clock-context', 'details', 'developer'];
const SECTIONS = ['advanced', 'transfer-plan', 'insights-build', 'comparison-help', 'comparison-open', 'model-assumptions'];
const KINDS: EntityClickType[] = ['machine', 'inserter', 'belt', 'chest', 'drill'];
const MAX_OFFSET = 4000;
const MAX_TEXT = 2_000_000;
export function defaultBuildViewContext(): BuildViewContext {
    return { version: 1, view: 'configure', configView: 'list', resultDetail: 'timeline', detailsTab: 'insights', sections: {},
        comparison: { allColumns: false, showUnstable: false }, wakeAsTable: false, diagramDetailed: true,
        timeline: { viewMode: 'simplified', sortMode: 'byType', filters: { machine: true, inserter: true, drill: true },
            statuses: { machine: Object.keys(MACHINE_STATUS_COLORS), inserter: Object.keys(INSERTER_STATUS_COLORS), drill: Object.keys(DRILL_STATUS_COLORS), categories: Object.keys(CATEGORY_COLORS) } },
        entity: null, entityConfigKey: null, position: {} };
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TEXT;
/** Only these real disclosures may be stored. Entity/insight keys are further checked against the loaded build. */
export function knownSection(key: string): boolean {
    return SECTIONS.includes(key) || /^machine-facts:[1-9]\d{0,5}$/.test(key) || /^insight:[a-zA-Z0-9_-]{1,100}$/.test(key);
}
function validateBuildViewContext(value: unknown): BuildViewContext {
    const d = defaultBuildViewContext();
    const v = record(value);
    if (v.version !== 1) return d;
    const comparison = record(v.comparison), entity = record(v.entity), timeline = record(v.timeline);
    const filters = record(timeline.filters), statuses = record(timeline.statuses);
    const allowed = { machine: MACHINE_STATUS_COLORS, inserter: INSERTER_STATUS_COLORS, drill: DRILL_STATUS_COLORS, categories: CATEGORY_COLORS };
    for (const key of Object.keys(d.timeline.statuses) as (keyof typeof allowed)[]) {
        if (Array.isArray(statuses[key])) d.timeline.statuses[key] = [...new Set((statuses[key] as unknown[]).filter((status): status is string => typeof status === 'string' && Object.hasOwn(allowed[key], status)))];
    }
    const sections: Record<string, boolean> = {};
    for (const [key, open] of Object.entries(record(v.sections)).slice(0, 500)) if (knownSection(key) && typeof open === 'boolean') sections[key] = open;
    const position: BuildViewContext['position'] = {};
    for (const view of ['configure', 'results'] as const) {
        const p = record(record(v.position)[view]);
        if (ANCHORS.includes(p.anchor as BuildAnchor) && typeof p.offset === 'number' && Number.isFinite(p.offset)) position[view] = { anchor: p.anchor as BuildAnchor, offset: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, p.offset)) };
    }
    // Preserve the destination of the previous Why / Wake tabs and nested blueprint view.
    const resultDetail = v.resultDetail === 'wake' ? 'timeline'
        : v.resultDetail === 'why' && v.detailsTab === 'blueprint' ? 'install'
        : v.resultDetail === 'why' ? 'overview'
        : oneOf(v.resultDetail, ['overview', 'timeline', 'install'], d.resultDetail);
    return { ...d, view: oneOf(v.view, ['configure', 'results'], d.view), configView: oneOf(v.configView, ['list', 'diagram'], d.configView),
        resultDetail, detailsTab: oneOf(v.detailsTab, ['insights', 'fuel', 'blueprint'], d.detailsTab), sections,
        comparison: { allColumns: bool(comparison.allColumns, false), showUnstable: bool(comparison.showUnstable, false) },
        wakeAsTable: bool(v.wakeAsTable, false), diagramDetailed: bool(v.diagramDetailed, true),
        timeline: { ...d.timeline, viewMode: oneOf(timeline.viewMode, ['simplified', 'detailed'], 'simplified'), sortMode: oneOf(timeline.sortMode, ['byType', 'byRelationship'], 'byType'),
            filters: { machine: bool(filters.machine, true), inserter: bool(filters.inserter, true), drill: bool(filters.drill, true) } },
        entity: KINDS.includes(entity.kind as EntityClickType) && Number.isSafeInteger(entity.id) && (entity.id as number) > 0 && text(entity.signature)
            ? { kind: entity.kind as EntityClickType, id: entity.id as number, signature: entity.signature } : null,
        entityConfigKey: text(v.entityConfigKey) ? v.entityConfigKey : null, position };
}
export const contextKeyOf = (buildId: string) => `clock-generator-view-context:${buildId}`;
export function readBuildViewContext(storage: Pick<Storage, 'getItem'> | null, buildId: string): BuildViewContext {
    try { const saved = storage?.getItem(contextKeyOf(buildId)); return saved && saved.length <= MAX_TEXT ? validateBuildViewContext(JSON.parse(saved)) : defaultBuildViewContext(); }
    catch { return defaultBuildViewContext(); }
}
export function writeBuildViewContext(storage: Pick<Storage, 'setItem'> | null, buildId: string, value: BuildViewContext): void {
    try { storage?.setItem(contextKeyOf(buildId), JSON.stringify(validateBuildViewContext(value))); } catch { /* Navigation still works when storage is blocked/full. */ }
}
export function removeBuildViewContext(storage: Pick<Storage, 'removeItem'> | null, buildId: string): void {
    try { storage?.removeItem(contextKeyOf(buildId)); } catch { /* Storage is optional. */ }
}
function entityOf(form: ConfigFormData, kind: EntityClickType, id: number) {
    const entities = kind === 'machine' ? form.machines : kind === 'inserter' ? form.inserters : kind === 'belt' ? form.belts : kind === 'chest' ? form.chests : form.drills?.configs ?? [];
    return entities.find(entity => entity.id === id);
}
/** Canonical entity signature, excluding the regenerated UI identity. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_uuid').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
}
export function selectBuildEntity(form: ConfigFormData, selection: { kind: EntityClickType; id: number } | null): BuildEntitySelection | null {
    const entity = selection && entityOf(form, selection.kind, selection.id);
    return entity && selection ? { ...selection, signature: JSON.stringify(canonical(entity)) } : null;
}
export function restoreBuildViewContext(value: BuildViewContext, form: ConfigFormData, hasResults: boolean, hasFuel: boolean, insightIds: readonly string[] = []): BuildViewContext {
    const identityMatches = value.entityConfigKey === serializeConfig(form);
    const current = value.entity && selectBuildEntity(form, value.entity);
    return { ...value, view: value.view === 'results' && hasResults ? 'results' : 'configure', detailsTab: value.detailsTab === 'fuel' && !hasFuel ? 'insights' : value.detailsTab,
        entity: identityMatches && current?.signature === value.entity?.signature ? current : null,
        position: identityMatches ? value.position : {},
        sections: Object.fromEntries(Object.entries(value.sections).filter(([key]) => key.startsWith('machine-facts:') ? identityMatches && form.machines.some(machine => key === `machine-facts:${machine.id}`) : !key.startsWith('insight:') || insightIds.includes(key.slice('insight:'.length)))) };
}
