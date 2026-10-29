// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { names, show } from '../test/fixtures';
import { TargetOutputForm } from './TargetOutputForm';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';
import { copyOffsetOf, copyOffsetShown, type CopyOffset } from '../utils/copyOffset';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { COUNTS_TEXT } from '../utils/targetCounts';

type Props = Parameters<typeof TargetOutputForm>[0];
const props: Props = { recipe: 'grenade', itemsPerSecond: 240, copies: 7, counts: 'made', machinesMax: null, recipeNames: ['grenade'],
    onRecipeChange: () => {}, onItemsPerSecondChange: () => {}, onCountsChange: () => {}, onCopiesChange: () => {} };
const form = (overrides: Partial<Props> = {}) => show(<TargetOutputForm {...props} {...overrides} />);
const countsField = () => screen.getByRole('combobox', { name: COUNTS_TEXT.label });

describe('what the rate counts', () => {
    it.each([
        { overrides: {}, reads: COUNTS_TEXT.made },
        { overrides: { showCopyOffset: true, onCopyOffsetChange: () => {} }, reads: COUNTS_TEXT.made },
        { overrides: { recipe: '', itemsPerSecond: 0 }, reads: COUNTS_TEXT.made },
        { overrides: { counts: 'destroyed' }, reads: COUNTS_TEXT.destroyed },
    ] satisfies { overrides: Partial<Props>; reads: string }[])('is a field shown always, beside Items per Second, that reads $reads for its target', ({ overrides, reads }) => {
        form(overrides);
        expect(countsField().textContent).toBe(reads);
        expect(screen.getByRole('button', { name: COUNTS_TEXT.helpLabel })).toBeDefined();
    });

    it('chooses the item destroyed from what the machines take in, not from the recipes (scrap is no recipe\'s product)', async () => {
        const gameNames = names({ scrap: 'Scrap' }, { 'scrap-recycling': 'Scrap recycling', 'iron-gear-wheel': 'Iron gear wheel' });
        const target = { recipe: 'scrap', itemsPerSecond: 2, copies: 1, recipeNames: ['scrap-recycling', 'iron-gear-wheel'], destroyedItemNames: ['scrap'] };
        const { user, rerender } = show(<TargetOutputForm {...props} {...target} counts="destroyed" />, { names: gameNames });
        await user.click(screen.getByRole('combobox', { name: TARGET_RECIPE_NAME }));
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Scrap']);

        rerender(<TargetOutputForm {...props} {...target} recipe="" counts="made" />);
        await user.click(screen.getByRole('button', { name: TARGET_RECIPE_NAME }));
        const picker = screen.getByRole('dialog', { name: `Choose a recipe for ${TARGET_RECIPE_NAME}` });
        expect(within(picker).getAllByRole('tab').map(tab => tab.getAttribute('aria-label'))).toEqual(['Intermediate products']);
        expect(within(within(picker).getByRole('group', { name: 'Choose a recipe' })).getAllByRole('button').map(recipe => recipe.getAttribute('aria-label')))
            .toEqual(['Iron gear wheel', 'Scrap recycling']);
    });

    it.each([
        { shown: 'made', picked: 'destroyed' },
        { shown: 'destroyed', picked: 'made' },
    ] as const)('offers Items made, the default, then Items destroyed, and reports the one picked ($picked)', async ({ shown, picked }) => {
        const onCountsChange = vi.fn();
        const { user } = form({ counts: shown, onCountsChange });
        await user.click(countsField());
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([COUNTS_TEXT.made, COUNTS_TEXT.destroyed]);
        expect(screen.getByRole('option', { selected: true }).textContent).toBe(COUNTS_TEXT[shown]);
        await user.click(screen.getByRole('option', { name: COUNTS_TEXT[picked] }));
        expect(onCountsChange).toHaveBeenCalledExactlyOnceWith(picked);
    });

    it('explains the two in the help, one paragraph each, in the words it was given', async () => {
        const { user } = form();
        await user.click(screen.getByRole('button', { name: COUNTS_TEXT.helpLabel }));
        const help = screen.getByRole('dialog', { name: COUNTS_TEXT.helpLabel });
        for (const paragraph of [COUNTS_TEXT.helpMade, COUNTS_TEXT.helpDestroyed]) expect(within(help).getByText(paragraph)).toBeDefined();
        expect(help.textContent).toBe(COUNTS_TEXT.helpMade + COUNTS_TEXT.helpDestroyed);
    });

    const max = { machineIds: [1], perCopy: 405, perCopyRatio: { numerator: 405, denominator: 1 } };
    it.each([
        { counts: 'destroyed', itemsPerSecond: 500, line: /^At most 405\/s: Machine 1 destroys 405\/s\./ },
        { counts: 'made', itemsPerSecond: 500, line: /^At most 405\/s: Machine 1 makes 405\/s\./ },
        { counts: 'destroyed', itemsPerSecond: 400, line: /^$/ },
    ] as const)('says what the machines make or destroy in the problem line under Items per Second, past what they can ($counts, $itemsPerSecond/s)', ({ counts, itemsPerSecond, line }) => {
        form({ recipe: 'iron-ore', itemsPerSecond, copies: 1, counts, machinesMax: max });
        // the line is read with the field
        expect(screen.getByRole('textbox', { name: 'Items per Second', description: line })).toBeDefined();
    });
});

describe('the gap between copies', () => {
    const note = 'At about 112 ticks a period, the hands of the 7 copies fit between each other on belt 1.';
    it.each([
        { when: 'they do', overrides: { showCopyOffset: true, onCopyOffsetChange: () => {} }, asked: true, says: null },
        { when: 'they do, saying whether the drops fit', overrides: { showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffsetNote: note }, asked: true, says: note },
        { when: 'they do, the engine saying nothing', overrides: { showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffsetNote: null }, asked: true, says: null },
        { when: 'they do not, whatever the engine says', overrides: { showCopyOffset: false, onCopyOffsetChange: () => {}, copyOffsetNote: note }, asked: false, says: null },
        { when: 'nothing says', overrides: {}, asked: false, says: null },
    ] satisfies { when: string; overrides: Partial<Props>; asked: boolean; says: string | null }[])(
        'is asked for beside Copies when the copies drop onto a belt from inserters with places, with the engine\'s word on the fit under it: $when', ({ overrides, asked, says }) => {
            form(overrides);
            expect(screen.queryByText('Next copy stands') !== null).toBe(asked);
            expect(screen.queryByText('of this one') !== null).toBe(asked);
            expect(screen.queryByRole('status')?.textContent ?? null).toBe(says);
        });

    it('is a number of tiles and a side, kept as the step from one copy to the next', () => {
        expect(copyOffsetOf(12, 'east')).toEqual({ x: 12, y: 0 });
        expect(copyOffsetOf(12, 'west')).toEqual({ x: -12, y: 0 });
        expect(copyOffsetOf(3, 'north')).toEqual({ x: 0, y: -3 });
        expect(copyOffsetOf(3, 'south')).toEqual({ x: 0, y: 3 });
        expect(copyOffsetOf(0, 'east')).toBeUndefined();
        expect(copyOffsetOf(null, 'east')).toBeUndefined();
        expect(copyOffsetShown({ x: -12, y: 0 })).toEqual({ tiles: 12, side: 'west' });
        expect(copyOffsetShown({ x: 0, y: -3 })).toEqual({ tiles: 3, side: 'north' });
        expect(copyOffsetShown(undefined)).toEqual({ tiles: null, side: 'east' });
        expect(copyOffsetShown({ x: 4, y: 2 })).toBe('diagonal');
    });

    const tilesField = () => document.getElementById(ELEMENT_IDS.targetCopyOffset);

    it('names its two fields, so that a screen reader reads what each one is for', () => {
        form({ showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffset: { x: 12, y: 0 } });
        expect(screen.getByRole('textbox', { name: 'Tiles to the next copy' })).toBe(tilesField());
        expect((screen.getByRole('textbox', { name: 'Tiles to the next copy' }) as HTMLInputElement).value).toBe('12');
        expect(screen.getByRole('combobox', { name: 'Side of the next copy' }).textContent).toBe('east');
    });

    it('reports the side picked in the field named for it', async () => {
        const onCopyOffsetChange = vi.fn();
        const { user } = form({ showCopyOffset: true, onCopyOffsetChange, copyOffset: { x: 12, y: 0 } });
        await user.click(screen.getByRole('combobox', { name: 'Side of the next copy' }));
        await user.click(screen.getByRole('option', { name: 'north' }));
        expect(onCopyOffsetChange).toHaveBeenCalledExactlyOnceWith({ x: 0, y: -12 });
    });

    it('shows a step that runs off the four sides as it is', () => {
        form({ showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffset: { x: 4, y: -2 } });
        expect(screen.getByText('4 tiles east and 2 tiles north')).toBeDefined();
        expect(tilesField()).toBeNull();
    });

    /** The form as the page holds it: the gap it reports is the gap it shows next */
    function Gap({ initial, onCopyOffsetChange }: { initial: CopyOffset; onCopyOffsetChange: (value: CopyOffset | undefined) => void }) {
        const [copyOffset, setCopyOffset] = useState<CopyOffset | undefined>(initial);
        return <TargetOutputForm {...props} showCopyOffset copyOffset={copyOffset} onCopyOffsetChange={value => { setCopyOffset(value); onCopyOffsetChange(value); }} />;
    }
    /** The gap field of a form at `initial`, focused; the arrow keys step it as its buttons do */
    const gap = async (initial: CopyOffset) => {
        const onCopyOffsetChange = vi.fn();
        const view = show(<Gap initial={initial} onCopyOffsetChange={onCopyOffsetChange} />);
        const field = tilesField()!;
        await view.user.click(field);
        return { ...view, field, onCopyOffsetChange };
    };

    it('steps up and down from a typed value, and never empties by stepping', async () => {
        const east = await gap({ x: 12, y: 0 });
        await east.user.clear(east.field);
        await east.user.type(east.field, '11');
        expect(east.onCopyOffsetChange).toHaveBeenLastCalledWith({ x: 11, y: 0 });
        await east.user.keyboard('{ArrowUp}');
        expect(east.onCopyOffsetChange).toHaveBeenLastCalledWith({ x: 12, y: 0 });
        await east.user.keyboard('{ArrowDown}');
        expect(east.onCopyOffsetChange).toHaveBeenLastCalledWith({ x: 11, y: 0 });
        east.unmount();

        // down from 3 stops at 1 tile: 0 tiles is the empty field, which the up arrow could not leave
        const north = await gap({ x: 0, y: -3 });
        await north.user.keyboard('{ArrowDown}'.repeat(5));
        expect(north.onCopyOffsetChange).toHaveBeenLastCalledWith({ x: 0, y: -1 });
        expect((north.field as HTMLInputElement).value).toBe('1');
        await north.user.keyboard('{ArrowUp}');
        expect(north.onCopyOffsetChange).toHaveBeenLastCalledWith({ x: 0, y: -2 });
    });

    it('steps up from an empty field to 1 tile, on the side it shows', async () => {
        const { user, field, onCopyOffsetChange } = await gap({ x: 12, y: 0 });
        await user.clear(field);
        expect(onCopyOffsetChange).toHaveBeenLastCalledWith(undefined);
        expect(screen.getByText('east')).toBeDefined();
        await user.keyboard('{ArrowUp}');
        expect(onCopyOffsetChange).toHaveBeenLastCalledWith({ x: 1, y: 0 });
    });
});
