import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConfigFormData } from '../utils/configForm/formData';
import { defaultBuildViewContext, knownSection, readBuildViewContext, removeBuildViewContext, restoreBuildViewContext, writeBuildViewContext, selectBuildEntity, type BuildAnchor, type BuildViewContext } from '../utils/buildViewContext';

export interface BuildContextReady { buildId: string; formKey: string; replacementRevision: number }
type Patch = Partial<BuildViewContext>;
interface SectionContext { sections: Record<string, boolean>; onSectionChange(key: string, open: boolean): void }
export const BuildSectionsContext = createContext<SectionContext | null>(null);
/** A small controlled seam for existing disclosures far below App. */
export function useBuildSection(key: string, initiallyOpen = false): [boolean, (open: boolean) => void] {
    const owner = useContext(BuildSectionsContext);
    const [localOpen, setLocalOpen] = useState(initiallyOpen);
    return owner && knownSection(key) ? [owner.sections[key] ?? initiallyOpen, open => owner.onSectionChange(key, open)] : [localOpen, setLocalOpen];
}
function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function stickyHeight(): number { return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')) || 0; }
function visibleAnchors(view: BuildViewContext['view']): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(`[data-build-view="${view}"] [data-build-anchor], [data-build-view="${view}"][data-build-anchor]`)].filter(element => element.getClientRects().length > 0);
}
function pagePosition(view: BuildViewContext['view']): BuildViewContext['position'][typeof view] {
    const anchors = visibleAnchors(view);
    const line = stickyHeight() + 8;
    const anchor = [...anchors].reverse().find(element => element.getBoundingClientRect().top <= line) ?? anchors[0];
    return anchor ? { anchor: anchor.dataset.buildAnchor as BuildAnchor, offset: Math.max(-4000, Math.min(4000, line - anchor.getBoundingClientRect().top)) } : undefined;
}
/** Navigation only: the form and kept clocks remain with their existing owners. */
export function useBuildViewContext({ buildId, ready, form, formKey, hasResults, hasFuel, replacementRevision, insightIds }: {
    buildId: string; ready: BuildContextReady | null; form: ConfigFormData; formKey: string; hasResults: boolean; hasFuel: boolean; replacementRevision: number; insightIds: readonly string[];
}) {
    const ownerKey = `${buildId}:${replacementRevision}`;
    const structure = JSON.stringify([form.machines, form.inserters, form.belts, form.chests, form.drills?.configs ?? []].map(rows => rows.map(row => [row.id, row._uuid])));
    const [state, setState] = useState<{ owner: string; hydrated: boolean; structure: string; context: BuildViewContext }>(() => ({ owner: ownerKey, hydrated: false, structure, context: defaultBuildViewContext() }));
    let context = state.owner === ownerKey ? state.context : defaultBuildViewContext();
    if (state.owner === ownerKey && (state.structure !== structure || (context.entity && selectBuildEntity(form, context.entity)?.signature !== context.entity.signature))) {
        context = { ...context, entity: null, position: {}, sections: Object.fromEntries(Object.entries(context.sections).filter(([key]) => !key.startsWith('machine-facts:'))) };
        setState({ ...state, structure, context });
    }
    const latest = useRef({ buildId, ownerKey, formKey, structure, context, ready });
    useLayoutEffect(() => { latest.current = { buildId, ownerKey, formKey, structure, context, ready }; }, [buildId, ownerKey, formKey, structure, context, ready]);
    const hydrated = useRef<string | null>(null);
    const pendingPatch = useRef<{ owner: string; patch: Patch } | null>(null);
    const replacement = useRef<{ owner: string; context: BuildViewContext } | null>(null);
    const restore = useRef<{ owner: string; cancelled: boolean; pending: boolean }>({ owner: ownerKey, cancelled: false, pending: false });
    const positions = useRef<{ owner: string; structure: string; value: BuildViewContext['position'] }>({ owner: ownerKey, structure, value: {} });
    useLayoutEffect(() => {
        if (positions.current.owner === ownerKey && positions.current.structure !== structure) positions.current = { owner: ownerKey, structure, value: {} };
    }, [ownerKey, structure]);
    const cancelRestore = useCallback(() => {
        const current = latest.current;
        restore.current = { owner: current.ownerKey, cancelled: true, pending: false };
    }, []);
    const patch = useCallback((change: Patch) => {
        cancelRestore();
        const current = latest.current;
        if (hydrated.current !== current.ownerKey) pendingPatch.current = { owner: current.ownerKey, patch: { ...(pendingPatch.current?.owner === current.ownerKey ? pendingPatch.current.patch : {}), ...change } };
        let position = positions.current.owner === current.ownerKey ? positions.current.value : current.context.position;
        if (hydrated.current === current.ownerKey && !restore.current.pending && change.view && change.view !== current.context.view) {
            const departing = pagePosition(current.context.view);
            if (departing) position = { ...position, [current.context.view]: departing };
        }
        positions.current = { owner: current.ownerKey, structure: current.structure, value: position };
        const next = { ...current.context, position, ...change };
        latest.current = { ...current, context: next };
        setState({ owner: current.ownerKey, hydrated: hydrated.current === current.ownerKey, structure: current.structure, context: next });
    }, [cancelRestore]);
    // No passive save may run for a different/unhydrated owner, including StrictMode effect replay.
    useLayoutEffect(() => {
        if (!ready || ready.buildId !== buildId || ready.formKey !== formKey || ready.replacementRevision !== replacementRevision || hydrated.current === ownerKey) return;
        const saved = replacement.current?.owner === ownerKey ? replacement.current.context : readBuildViewContext(storage(), buildId);
        const loaded = restoreBuildViewContext(saved, form, hasResults, hasFuel, insightIds);
        const edits = pendingPatch.current?.owner === ownerKey ? pendingPatch.current.patch : {};
        const next = { ...loaded, ...edits };
        hydrated.current = ownerKey;
        positions.current = { owner: ownerKey, structure, value: next.position };
        pendingPatch.current = null;
        replacement.current = null;
        const cancelled = restore.current.owner === ownerKey && restore.current.cancelled;
        restore.current = { owner: ownerKey, cancelled, pending: !cancelled };
        latest.current = { ...latest.current, context: next };
        setState({ owner: ownerKey, hydrated: true, structure, context: next });
    }, [ready, buildId, formKey, form, hasResults, hasFuel, replacementRevision, ownerKey, insightIds, structure]);
    const saveDeparture = useCallback(() => {
        const current = latest.current;
        if (hydrated.current !== current.ownerKey) return;
        const position = restore.current.pending ? undefined : pagePosition(current.context.view);
        const previous = positions.current.owner === current.ownerKey ? positions.current.value : current.context.position;
        const updated = position ? { ...previous, [current.context.view]: position } : previous;
        positions.current = { owner: current.ownerKey, structure: current.structure, value: updated };
        const value = { ...current.context, entityConfigKey: current.formKey, position: updated };
        writeBuildViewContext(storage(), current.buildId, value);
    }, []);
    useEffect(() => {
        if (state.owner === ownerKey && state.hydrated && hydrated.current === ownerKey) saveDeparture();
    }, [state, ownerKey, formKey, saveDeparture]);
    // Two completed layout frames after hydration; restoring never moves keyboard focus.
    useEffect(() => {
        if (state.owner !== ownerKey || !state.hydrated || hydrated.current !== ownerKey || !restore.current.pending) return;
        let first = 0, second = 0;
        first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
            const current = latest.current;
            if (current.ownerKey !== ownerKey || restore.current.cancelled || !restore.current.pending) return;
            restore.current.pending = false;
            const position = current.context.position[current.context.view] ?? { anchor: current.context.view, offset: 0 };
            const anchors = visibleAnchors(current.context.view);
            const exact = anchors.find(element => element.dataset.buildAnchor === position.anchor);
            const parent: Partial<Record<BuildAnchor, BuildAnchor>> = { details: 'clock-context', 'clock-context': 'selected-clock', comparison: 'selected-clock', 'selected-clock': 'results', developer: 'results', advanced: 'build', build: 'configure', target: 'configure' };
            let fallback = position.anchor;
            let anchor = exact;
            while (!anchor && parent[fallback]) {
                fallback = parent[fallback]!;
                anchor = anchors.find(element => element.dataset.buildAnchor === fallback);
            }
            anchor ??= anchors[0];
            if (!anchor) return;
            const offset = exact ? Math.min(position.offset, Math.max(0, anchor.getBoundingClientRect().height - 1)) : 0;
            const top = window.scrollY + anchor.getBoundingClientRect().top + offset - stickyHeight() - 8;
            window.scrollTo({ top: Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, top)), behavior: 'instant' });
        }); });
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, [state, ownerKey]);
    useEffect(() => {
        const cancel = () => cancelRestore();
        const scroll = () => { cancelRestore(); saveDeparture(); };
        const leave = () => saveDeparture();
        window.addEventListener('wheel', cancel, { passive: true });
        window.addEventListener('touchstart', cancel, { passive: true });
        window.addEventListener('pointerdown', cancel, true);
        window.addEventListener('keydown', cancel, true);
        window.addEventListener('scroll', scroll, { passive: true });
        window.addEventListener('pagehide', leave);
        return () => {
            window.removeEventListener('wheel', cancel); window.removeEventListener('touchstart', cancel);
            window.removeEventListener('pointerdown', cancel, true); window.removeEventListener('keydown', cancel, true);
            window.removeEventListener('scroll', scroll); window.removeEventListener('pagehide', leave);
        };
    }, [cancelRestore, saveDeparture]);
    const resetForReplacement = useCallback(() => {
        cancelRestore();
        const current = latest.current;
        // The caller increments the same revision synchronously with its authoritative replacement.
        const nextOwner = `${current.buildId}:${Number(current.ownerKey.slice(current.ownerKey.lastIndexOf(':') + 1)) + 1}`;
        const next = { ...current.context, view: 'configure' as const, entity: null, entityConfigKey: null, position: {}, sections: { ...current.context.sections, advanced: false } };
        replacement.current = { owner: nextOwner, context: next };
        hydrated.current = null;
        setState({ owner: nextOwner, hydrated: false, structure: current.structure, context: next });
    }, [cancelRestore]);
    const forgetBuild = useCallback((id: string) => { removeBuildViewContext(storage(), id); }, []);
    return { context, patch, cancelRestore, saveDeparture, resetForReplacement, forgetBuild };
}
