import { describe, expect, it } from 'vitest';
import type { ClockStrategy, StrategyFamily, StrategyQualifier } from 'clock-generator/browser';
import { CHIP_SEPARATOR, FAMILY_COPY, familyCopyOf, fullClockName, pendingClockName, qualifierChipsOf, strategyNameOf, type NamedClock } from './strategyNames';

const strategy = (family: StrategyFamily, qualifiers: StrategyQualifier[] = ['output-swings'], output_swings = 2): ClockStrategy => ({ family, qualifiers, output_swings });
const clock = (extra: Partial<NamedClock> & { strategy?: ClockStrategy } = {}): NamedClock => ({ label: 'Engine label', strategy: strategy('takt-batches'), ...extra });

describe('strategyNameOf and familyCopyOf', () => {
    it('names a clock by its strategy\'s family', () => {
        expect(strategyNameOf(clock())).toBe('Takt batches');
        expect(strategyNameOf(clock({ strategy: strategy('round-robin-polling') }))).toBe('Round-robin polling');
        expect(familyCopyOf(clock({ strategy: strategy('exhaust') }))?.name).toBe('Exhaust');
    });

    it('names a clock kept before the strategy was carried by its engine label, with no chips', () => {
        const kept = { label: 'Batched swings: 2 output swings per cycle' };
        expect(strategyNameOf(kept)).toBe(kept.label);
        expect(familyCopyOf(kept)).toBeNull();
        expect(qualifierChipsOf(kept)).toEqual([]);
        expect(fullClockName(kept)).toBe(kept.label);
    });

    it('has a name, a line, a definition and a practice for every family, and no old name', () => {
        const families = Object.keys(FAMILY_COPY) as StrategyFamily[];
        expect(families).toHaveLength(10);
        for (const family of families) {
            const copy = FAMILY_COPY[family];
            for (const text of Object.values(copy)) expect(text.length).toBeGreaterThan(0);
            expect(JSON.stringify(copy)).not.toMatch(/Batched swings|Small batches|Observed windows|Even hands|Shifted swings|wake-up|wake window|target output/i);
        }
    });
});

describe('qualifierChipsOf', () => {
    it('says the output swings of a cycle, in the singular for one', () => {
        expect(qualifierChipsOf(clock()).map(chip => chip.label)).toEqual(['2 output swings a cycle']);
        expect(qualifierChipsOf(clock({ strategy: strategy('takt-batches', ['output-swings'], 1) })).map(chip => chip.label)).toEqual(['1 output swing a cycle']);
    });

    it('says the hands brought in for a target that counts an item destroyed', () => {
        expect(qualifierChipsOf(clock({ strategy: strategy('time-division-slots', ['hands-brought-in'], 3) })).map(chip => chip.label)).toEqual(['3 hands brought in a cycle']);
    });

    it('says the ticks a rounded clock is rounded to, and how fast it runs', () => {
        const rounded = clock({ strategy: strategy('takt-batches', ['output-swings', 'rounded-clock']), roundedPeriodTicks: 600, roundedRunsFast: 0.0002 });
        expect(qualifierChipsOf(rounded).map(chip => chip.label)).toEqual(['2 output swings a cycle', 'rounded to 600 ticks, 0.02% fast']);
        expect(qualifierChipsOf({ ...rounded, roundedRunsFast: 0.000001 })[1].label).toBe('rounded to 600 ticks, under 0.01% fast');
    });

    it('has a label and a line for every qualifier the engine can carry', () => {
        const all: StrategyQualifier[] = ['output-swings', 'hands-brought-in', 'shared-enable-windows', 'window-a-swing', 'shorter-window-cycle', 'phase-accumulator',
            'rounded-clock', 'loop-windows', 'loop-exits-only', 'drill-windows-longer', 'drills-always-on', 'fuel-hand-room', 'found-by-search', 'pickups-from-entry',
            'harmonic-window-cycle'];
        const chips = qualifierChipsOf(clock({ strategy: strategy('takt-batches', all) }));
        expect(chips.map(chip => chip.id)).toEqual(all);
        for (const chip of chips) {
            expect(chip.label.length).toBeGreaterThan(0);
            expect(chip.line.length).toBeGreaterThan(0);
            expect(chip.label + chip.line).not.toMatch(/wake-up|window cycle time|\bperiod\b|whole swings only/i);
        }
    });

    it('cites a source for the harmonic window cycle, the kanban latch and the split-time controller', () => {
        const harmonic = qualifierChipsOf(clock({ strategy: strategy('takt-batches', ['harmonic-window-cycle']) }))[0];
        expect(harmonic.line).toContain('Spectral Audio Signal Processing');
        const kanban = qualifierChipsOf(clock({ strategy: strategy('takt-batches', ['loop-windows']) }))[0];
        expect(kanban.line).toContain('hysteresis');
        expect(FAMILY_COPY['euclidean-swings'].practice).toContain('split-time controller');
    });
});

describe('fullClockName', () => {
    it('joins the name and the chips', () => {
        const shared = clock({ strategy: strategy('round-robin-polling', ['output-swings', 'shared-enable-windows']) });
        expect(fullClockName(shared)).toBe(['Round-robin polling', '2 output swings a cycle', 'shared enable windows'].join(CHIP_SEPARATOR));
    });
});

describe('pendingClockName', () => {
    it('names a task whose family is known by its family', () => {
        expect(pendingClockName({ id: 'derived', label: 'Observed windows' })).toBe('Time-study windows');
        expect(pendingClockName({ id: 'full-hand', label: 'Full-hand output swings' })).toBe('Pitch pickups');
        expect(pendingClockName({ id: 'primitive-grouped', label: 'Small batches' })).toBe('Round-robin polling');
        expect(pendingClockName({ id: 'per-branch', label: 'Coordinated parts' })).toBe('Coordinated signal system');
    });

    it('names a count of output swings by the count alone, as its family is known only after the run', () => {
        expect(pendingClockName({ id: 'swings-6', label: '6 output swings per cycle' })).toBe('6 output swings a cycle');
        expect(pendingClockName({ id: 'swings-1', label: '1 output swing per cycle' })).toBe('1 output swing a cycle');
    });

    it('keeps the label of a task it does not know', () => {
        expect(pendingClockName({ id: 'other', label: 'Other clock' })).toBe('Other clock');
    });
});
