import { describe, expect, it } from 'vitest';
import type { ClockRouting, ClockStrategy, StrategyConstruction, StrategyFamily, StrategyQualifier } from 'clock-generator/browser';
import { CHIP_SEPARATOR, directRouterOf, familyCopyOf, fullClockName, pendingClockName, qualifierChipsOf, sourceLinesOf, strategyNameOf, type NamedClock } from './strategyNames';

const FAMILIES: StrategyFamily[] = ['takt-batches', 'round-robin-polling', 'euclidean-swings', 'time-division-slots', 'time-study-windows', 'moved-output-swing',
    'signal-offset', 'pitch-pickups', 'exhaust', 'per-branch'];

const strategy = (family: StrategyFamily, qualifiers: StrategyQualifier[] = ['output-swings'], output_swings = 2, construction?: StrategyConstruction): ClockStrategy =>
    ({ family, qualifiers, output_swings, routing: { router: 'direct' }, ...(construction !== undefined && { construction }) });
const withRouting = (base: ClockStrategy, routing: ClockRouting): ClockStrategy => ({ ...base, routing });
const labels = (value: NamedClock) => qualifierChipsOf(value).map(chip => chip.label);
const clock = (extra: Partial<NamedClock> & { strategy?: ClockStrategy } = {}): NamedClock => ({ label: 'Engine label', strategy: strategy('takt-batches'), ...extra });

describe('strategyNameOf and familyCopyOf', () => {
    it('names a clock by the catalog row of its strategy', () => {
        expect(strategyNameOf(clock())).toBe('Takt Batches');
        expect(strategyNameOf(clock({ strategy: strategy('takt-batches', ['output-swings'], 2, 'planning-run') }))).toBe('Takt Batches');
        expect(strategyNameOf(clock({ strategy: strategy('round-robin-polling') }))).toBe('Round-Robin Polling');
        expect(strategyNameOf(clock({ strategy: strategy('signal-offset') }))).toBe('Phase-Shifted Batch');
        expect(familyCopyOf(clock({ strategy: strategy('exhaust') }))?.name).toBe('Exhaust');
    });

    it('names a Coordinated Sources clock by its router', () => {
        const coordinated = clock({ strategy: withRouting(strategy('per-branch'), { router: 'coordinated_sources', sources: [] }) });
        expect(strategyNameOf(coordinated)).toBe('Coordinated Sources');
        expect(familyCopyOf(coordinated)?.line).toContain('own enable windows');
    });

    it('says Direct in the (i) of a clock that follows one strategy, and not for Coordinated Sources', () => {
        expect(directRouterOf(clock())?.name).toBe('Direct');
        expect(directRouterOf(clock({ strategy: withRouting(strategy('per-branch'), { router: 'coordinated_sources', sources: [] }) }))).toBeNull();
        expect(directRouterOf({ label: 'kept' })).toBeNull();
        expect(labels(clock())).not.toContain('Direct');
    });

    it('names a clock kept before the strategy was carried by its engine label, with no chips', () => {
        const kept = { label: 'Batched swings: 2 output swings per cycle' };
        expect(strategyNameOf(kept)).toBe(kept.label);
        expect(familyCopyOf(kept)).toBeNull();
        expect(qualifierChipsOf(kept)).toEqual([]);
        expect(fullClockName(kept)).toBe(kept.label);
    });

    it('reads a name, a line, a definition and a practice from the catalog for every family, and no old name', () => {
        for (const family of FAMILIES) {
            const row = familyCopyOf(clock({ strategy: strategy(family) }));
            expect(row).not.toBeNull();
            for (const text of [row?.name, row?.line, row?.definition, row?.practice]) expect(text?.length).toBeGreaterThan(0);
            expect(JSON.stringify(row)).not.toMatch(/Batched swings|Small batches|Observed windows|Even hands|Shifted swings|Coordinated signal|wake-up|wake window|target output/i);
        }
    });
});

describe('the tuning method and selection chips', () => {
    it('come first after the name, with a tooltip each', () => {
        const chips = qualifierChipsOf(clock());
        expect(chips.map(chip => [chip.id, chip.label])).toEqual([['tuning_method', 'calculated'], ['selection', 'one version'], ['output-swings', '2 output swings a cycle']]);
        expect(chips[0].line).toContain('calculated from the build');
        expect(chips[1].line.length).toBeGreaterThan(0);
    });

    it('tell the two Takt Batches apart by the tuning method', () => {
        expect(labels(clock())).toContain('calculated');
        expect(labels(clock({ strategy: strategy('takt-batches', ['output-swings'], 2, 'planning-run') }))).toContain('observed');
    });

    it('say observed and found by search for the searched strategies, and the selection once (no found-by-search chip)', () => {
        const searched = labels(clock({ strategy: strategy('pitch-pickups', ['output-swings', 'found-by-search']) }));
        expect(searched).toEqual(['observed', 'found by search', '2 output swings a cycle']);
    });

    it('say best of several versions for Round-Robin Polling and have no tuning method for Coordinated Sources', () => {
        expect(labels(clock({ strategy: strategy('round-robin-polling') }))).toEqual(['calculated', 'best of several versions', '2 output swings a cycle']);
        const coordinated = clock({ strategy: withRouting(strategy('per-branch'), { router: 'coordinated_sources', sources: [] }) });
        expect(labels(coordinated)).toEqual(['best of several versions', '2 output swings a cycle']);
    });
});

describe('sourceLinesOf', () => {
    it('is empty for a clock with no routing, a direct one, and a Coordinated Sources one with no sources', () => {
        expect(sourceLinesOf(clock())).toEqual([]);
        expect(sourceLinesOf(clock({ strategy: withRouting(strategy('takt-batches'), { router: 'direct' }) }))).toEqual([]);
        expect(sourceLinesOf(clock({ strategy: withRouting(strategy('per-branch'), { router: 'coordinated_sources', sources: [] }) }))).toEqual([]);
        expect(sourceLinesOf({ label: 'kept' })).toEqual([]);
    });

    it('says what each source was given: a strategy name and tuning method, or "always enabled" and its reason', () => {
        const coordinated = clock({
            strategy: withRouting(strategy('per-branch'), {
                router: 'coordinated_sources',
                sources: [
                    { source: 'machine:2', entities: { 'inserter:3': { kind: 'strategy', family: 'takt-batches', construction: 'planning-run' }, 'inserter:4': { kind: 'strategy', family: 'takt-batches', construction: 'planning-run' } } },
                    { source: 'chest:1', entities: { 'inserter:5': { kind: 'always_on', reason: { kind: 'loop' } } } },
                    { source: 'belt:1', entities: { 'inserter:6': { kind: 'strategy', family: 'round-robin-polling', construction: 'grouped-hands' }, 'drill:1': { kind: 'always_on', reason: { kind: 'no-swing' } } } },
                ],
            }),
        });
        const lines = sourceLinesOf(coordinated);
        expect(lines[0]).toBe('Machine 2 \u2192 Takt Batches · observed');
        expect(lines[1]).toMatch(/^Chest 1 \u2192 always enabled: it moves items between machines/);
        expect(lines[2]).toMatch(/^Belt 1 \u2192 Inserter 6: Round-Robin Polling · calculated; Drill 1: always enabled: /);
    });
});

describe('qualifierChipsOf', () => {
    it('says the output swings of a cycle, in the singular for one', () => {
        expect(labels(clock())).toContain('2 output swings a cycle');
        expect(labels(clock({ strategy: strategy('takt-batches', ['output-swings'], 1) }))).toContain('1 output swing a cycle');
    });

    it('says the hands brought in for a target that counts an item destroyed', () => {
        expect(labels(clock({ strategy: strategy('time-division-slots', ['hands-brought-in'], 3) }))).toContain('3 hands brought in a cycle');
    });

    it('says the ticks a rounded clock is rounded to, and how fast it runs', () => {
        const rounded = clock({ strategy: strategy('takt-batches', ['output-swings', 'rounded-clock']), roundedPeriodTicks: 600, roundedRunsFast: 0.0002 });
        expect(labels(rounded).slice(2)).toEqual(['2 output swings a cycle', 'rounded to 600 ticks, 0.02% fast']);
        expect(labels({ ...rounded, roundedRunsFast: 0.000001 })[3]).toBe('rounded to 600 ticks, under 0.01% fast');
    });

    it('has a label and a line for every qualifier the engine can carry', () => {
        const all: StrategyQualifier[] = ['output-swings', 'hands-brought-in', 'shared-enable-windows', 'window-a-swing', 'shorter-window-cycle', 'phase-accumulator',
            'rounded-clock', 'loop-windows', 'loop-exits-only', 'drill-windows-longer', 'drills-always-on', 'fuel-hand-room', 'pickups-from-entry',
            'harmonic-window-cycle'];
        // found by search is the selection chip's: no qualifier chip of its own
        const chips = qualifierChipsOf(clock({ strategy: strategy('takt-batches', [...all, 'found-by-search']) }));
        expect(chips.map(chip => chip.id)).toEqual(['tuning_method', 'selection', ...all]);
        for (const chip of chips) {
            expect(chip.label.length).toBeGreaterThan(0);
            expect(chip.line.length).toBeGreaterThan(0);
            expect(chip.label + chip.line).not.toMatch(/wake-up|window cycle time|\bperiod\b|whole swings only/i);
        }
    });

    it('cites a source for the harmonic window cycle, the kanban latch and the split-time controller', () => {
        const harmonic = qualifierChipsOf(clock({ strategy: strategy('takt-batches', ['harmonic-window-cycle']) }))[2];
        expect(harmonic.line).toContain('Spectral Audio Signal Processing');
        const kanban = qualifierChipsOf(clock({ strategy: strategy('takt-batches', ['loop-windows']) }))[2];
        expect(kanban.line).toContain('hysteresis');
        expect(familyCopyOf(clock({ strategy: strategy('euclidean-swings') }))?.practice).toContain('split-time controller');
    });

    it('calls the phase accumulator chip the subtick clock', () => {
        const subtick = qualifierChipsOf(clock({ strategy: strategy('takt-batches', ['phase-accumulator']) }))[2];
        expect(subtick.label).toBe('subtick clock');
    });
});

describe('fullClockName', () => {
    it('joins the name and the chips', () => {
        const shared = clock({ strategy: strategy('round-robin-polling', ['output-swings', 'shared-enable-windows']) });
        expect(fullClockName(shared)).toBe(['Round-Robin Polling', 'calculated', 'best of several versions', '2 output swings a cycle', 'shared enable windows'].join(CHIP_SEPARATOR));
    });
});

describe('pendingClockName', () => {
    it('names a task whose family is known by its family', () => {
        expect(pendingClockName({ id: 'derived', label: 'Observed windows' })).toBe('Time-Study Windows');
        expect(pendingClockName({ id: 'full-hand', label: 'Full-hand output swings' })).toBe('Pitch Pickups');
        expect(pendingClockName({ id: 'primitive-grouped', label: 'Small batches' })).toBe('Round-Robin Polling');
        expect(pendingClockName({ id: 'per-branch', label: 'Coordinated sources' })).toBe('Coordinated Sources');
    });

    it('names a count of output swings by the count alone, as its family is known only after the run', () => {
        expect(pendingClockName({ id: 'swings-6', label: '6 output swings per cycle' })).toBe('6 output swings a cycle');
        expect(pendingClockName({ id: 'swings-1', label: '1 output swing per cycle' })).toBe('1 output swing a cycle');
    });

    it('keeps the label of a task it does not know', () => {
        expect(pendingClockName({ id: 'other', label: 'Other clock' })).toBe('Other clock');
    });
});
