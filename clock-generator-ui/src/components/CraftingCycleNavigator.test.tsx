import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CraftingCycleNavigator } from './CraftingCycleNavigator';
import { craftingCycles } from '../utils/craftingCycles';
import { GLOSSARY } from '../utils/glossary';

it('uses the exact glossary definition and the saved planned cycle size', () => {
    const html = renderToStaticMarkup(<CraftingCycleNavigator cycles={craftingCycles(96, 480)} index={1} periodTicks={480} swings={5} onSelect={() => {}} />);
    expect(html).toContain(GLOSSARY.find(entry => entry.id === 'crafting-cycle')!.definition);
    expect(html).toContain('96–192 ticks · 96 ticks per crafting cycle');
    expect(html).toContain('5 total output swings per crafting cycle');
    expect(html).toContain('480 ticks (5 crafting cycles)');
    expect(html).not.toContain('ingredients are consumed');
});
it('bounds navigation and explains unavailable metadata', () => {
    const last = renderToStaticMarkup(<CraftingCycleNavigator cycles={craftingCycles(96, 480)} index={4} periodTicks={480} swings={5} onSelect={() => {}} />);
    expect(last).toMatch(/<button[^>]*disabled[^>]*>Next cycle/);
    const missing = renderToStaticMarkup(<CraftingCycleNavigator cycles={null} index={0} periodTicks={480} swings={5} onSelect={() => {}} />);
    expect(missing).toContain('does not include a valid crafting-cycle length');
});
