import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Config, ConfigValidation } from 'clock-generator/browser';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { CheckPlanSection } from './CheckPlanSection';
import { CraftingCycleNavigator } from './CraftingCycleNavigator';
import { OverridesForm } from './OverridesForm';
import { craftingCycles } from '../utils/craftingCycles';
import { HANDS_TEXT } from '../utils/targetCounts';

// a target that counts the item destroyed has inserters that bring the item in, not output inserters: what the plan, the
// forced count and the cycles say is the hands brought into the machine that destroys it

const plan = (counts: 'made' | 'destroyed', hands = 5): ConfigValidation => ({ output_swings_per_cycle: hands, counts, cycle_ticks: 12, used_lcm: 12,
    period_ticks: 144, transfer_plan: { entities: [], computed_lcm: 12 } }) as unknown as ConfigValidation;
const checkPlan = (validation: ConfigValidation) => renderToStaticMarkup(createElement(CheckPlanSection, {
    validation: { status: 'valid', config: {} as Config, validation } as ValidationState, checkStatus: 'valid', busy: false, onCheckOnly: vi.fn(),
    note: null, excludedIngredients: [], onExcludeChange: vi.fn() }));
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ');

describe('the check only plan', () => {
    it('says what an output machine gives up for a target that counts the item made, as before', () => {
        expect(text(checkPlan(plan('made')))).toContain('Each output machine has 5 total output swings per crafting cycle of 12 ticks, shared equally across its output inserters, '
            + 'and the clock repeats every 144 ticks (12 crafting cycles). Generating may still use fewer swings if this count does not hold the rate.');
    });
    it('says the hands brought into the machine that destroys the item for a target that counts it destroyed', () => {
        expect(text(checkPlan(plan('destroyed')))).toContain('Each machine that destroys the item has 5 hands brought in per crafting cycle of 12 ticks, shared equally across '
            + 'the inserters that bring them in, and the clock repeats every 144 ticks (12 crafting cycles). Generating may still use fewer hands if this count does not hold the rate.');
        expect(text(checkPlan(plan('destroyed', 1)))).toContain('has 1 hand brought in per crafting cycle');
    });
});

describe('Advanced\'s forced count', () => {
    const form = (counts?: 'made' | 'destroyed') => renderToStaticMarkup(createElement(OverridesForm, { expanded: true, onExpandedChange: vi.fn(), setCount: 0,
        onUpdate: vi.fn(), ...(counts && { counts }) }));
    it('is of output swings unless the target counts the item destroyed', () => {
        for (const html of [form(), form('made')]) {
            expect(html).toContain('>Force Output Swings</label>');
            expect(html).toContain('aria-label="About Force Output Swings"');
            expect(html).toContain('Total output swings per crafting cycle of each output machine');
            expect(html).not.toContain('hands brought');
        }
    });
    it('is of hands brought in for a target that counts the item destroyed', () => {
        const html = form('destroyed');
        expect(html).toContain('>Force Hands Brought In</label>');
        expect(html).toContain('aria-label="About Force Hands Brought In"');
        expect(html).toContain('Total hands brought into each machine that destroys the item per crafting cycle');
        expect(text(html)).toContain('Note: Each machine’s hands brought in are divided equally among the inserters that bring them in; per-inserter counts may be fractional.');
        expect(html).not.toContain('output swings');
    });
});

describe('the crafting cycle navigator', () => {
    const navigator = (counts?: 'destroyed', swings = 5) => text(renderToStaticMarkup(createElement(CraftingCycleNavigator, { cycles: craftingCycles(12, 144), index: 0,
        periodTicks: 144, swings, onSelect: vi.fn(), ...(counts && { counts }) })));
    it('says the hands brought in for a target that counts the item destroyed', () => {
        expect(navigator()).toContain('Each output machine has 5 total output swings per crafting cycle.');
        expect(navigator('destroyed')).toContain('Each machine that destroys the item has 5 hands brought in per crafting cycle.');
        expect(navigator('destroyed', 1.25)).toContain('has 1.25 hands brought in per crafting cycle.');
    });
});

describe('the clock a destroyed target gets', () => {
    it('is named by its hands brought in', () => {
        expect(HANDS_TEXT.clock(5)).toBe('5 hands brought in');
        expect(HANDS_TEXT.clock(1)).toBe('1 hand brought in');
    });
});
