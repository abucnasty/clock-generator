import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TargetOutputForm } from './TargetOutputForm';
import { copyOffsetOf, copyOffsetShown, type CopyOffset } from '../utils/copyOffset';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { COUNTS_CHOICES } from '../utils/targetCounts';

const text = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const form = (props: Partial<Parameters<typeof TargetOutputForm>[0]> = {}) => renderToStaticMarkup(
    <TargetOutputForm recipe="grenade" itemsPerSecond={240} copies={7} counts="made" machinesMax={null} recipeNames={['grenade']}
        onRecipeChange={() => {}} onItemsPerSecondChange={() => {}} onCountsChange={() => {}} onCopiesChange={() => {}} {...props} />);

describe('what the rate counts', () => {
    it('is a field shown always, beside Items per Second, that reads Items made by default', () => {
        for (const props of [{}, { showCopyOffset: true, onCopyOffsetChange: () => {} }, { recipe: '', itemsPerSecond: 0 }]) {
            const html = form(props);
            expect(html).toContain('>Counts<');
            expect(html).toContain('value="made"');
            expect(text(html)).toContain('Items made');
            expect(html).toContain('aria-label="About made and destroyed"');
        }
    });

    it('reads Items destroyed for a target that counts the item destroyed', () => {
        const html = form({ counts: 'destroyed' });
        expect(html).toContain('value="destroyed"');
        expect(text(html)).toContain('Items destroyed');
    });

    it('chooses the item destroyed from what the machines take in, not from the recipes (scrap is no recipe\'s product)', () => {
        const props = { recipe: 'scrap', itemsPerSecond: 2, copies: 1, machinesMax: null, recipeNames: ['scrap-recycling', 'iron-gear-wheel'],
            destroyedItemNames: ['scrap'], onRecipeChange: () => {}, onItemsPerSecondChange: () => {}, onCountsChange: () => {}, onCopiesChange: () => {} };
        const picker = (counts: 'made' | 'destroyed') => findElement(TargetOutputForm({ ...props, counts }), (it) => it.inputId === ELEMENT_IDS.targetRecipe);
        expect([picker('destroyed').kind, picker('destroyed').options]).toEqual(['item', ['scrap']]);
        expect([picker('made').kind, picker('made').options]).toEqual(['recipe', ['scrap-recycling', 'iron-gear-wheel']]);
    });

    it('offers Items made, the default, then Items destroyed, and reports the one picked', () => {
        expect(COUNTS_CHOICES.map(choice => [choice.value, choice.label])).toEqual([['made', 'Items made'], ['destroyed', 'Items destroyed']]);
        let picked: string | undefined;
        const select = findElement(TargetOutputForm({ recipe: 'iron-ore', itemsPerSecond: 400, copies: 1, counts: 'made', machinesMax: null, recipeNames: [],
            onRecipeChange: () => {}, onItemsPerSecondChange: () => {}, onCountsChange: (counts) => { picked = counts; }, onCopiesChange: () => {} }),
            (props) => props.label === 'Counts');
        (select.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'destroyed' } });
        expect(picked).toBe('destroyed');
    });

    it('explains the two in the help, one paragraph each, in the words it was given', () => {
        const help = findElement(TargetOutputForm({ recipe: 'iron-ore', itemsPerSecond: 400, copies: 1, counts: 'made', machinesMax: null, recipeNames: [],
            onRecipeChange: () => {}, onItemsPerSecondChange: () => {}, onCountsChange: () => {}, onCopiesChange: () => {} }),
            (props) => props.label === 'About made and destroyed');
        const paragraphs = (Array.isArray(help.children) ? help.children : [help.children]).map((paragraph) => (paragraph as ReactElement<{ children: string }>).props.children);
        expect(paragraphs).toEqual([
            'Items made: the build makes the item and its inserters take it out.',
            'Items destroyed: inserters bring the item into the build and a recycler destroys it, as in an ore voider. '
                + 'The rate is what they bring in. What the recycler gives back and the build puts back into it is not counted.',
        ]);
    });

    it('says destroys in the problem line under Items per Second for a target the machines cannot destroy', () => {
        const max = { machineIds: [1], perCopy: 405, perCopyRatio: { numerator: 405, denominator: 1 } };
        expect(text(form({ recipe: 'iron-ore', itemsPerSecond: 500, copies: 1, counts: 'destroyed', machinesMax: max })))
            .toContain('At most 405/s: Machine 1 destroys 405/s.');
        expect(text(form({ recipe: 'iron-ore', itemsPerSecond: 500, copies: 1, counts: 'made', machinesMax: max })))
            .toContain('At most 405/s: Machine 1 makes 405/s.');
        expect(text(form({ recipe: 'iron-ore', itemsPerSecond: 400, copies: 1, counts: 'destroyed', machinesMax: max }))).not.toContain('At most');
    });
});

/** The props of the first element of a form's element tree that `match` accepts (the form called as a function, without a DOM) */
function findElement(tree: ReactNode, match: (props: Record<string, unknown>) => boolean) {
    const found: { onChange?: unknown; children?: ReactNode; [key: string]: unknown }[] = [];
    const walk = (node: ReactNode) => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (isValidElement<{ children?: ReactNode }>(node)) {
            if (match(node.props as Record<string, unknown>)) found.push(node.props as never);
            walk(node.props.children);
        }
    };
    walk(tree);
    expect(found).toHaveLength(1);
    return found[0];
}

describe('the gap between copies', () => {
    it('is asked for beside Copies when the copies drop onto a belt from inserters with places, and not otherwise', () => {
        expect(text(form({ showCopyOffset: true, onCopyOffsetChange: () => {} }))).toContain('Next copy stands');
        expect(text(form({ showCopyOffset: true, onCopyOffsetChange: () => {} }))).toContain('of this one');
        expect(text(form({ showCopyOffset: false, onCopyOffsetChange: () => {} }))).not.toContain('Next copy stands');
        expect(text(form())).not.toContain('Next copy stands');
    });

    it('says under the gap whether the drops fit, when the engine has something to say', () => {
        const note = 'At about 112 ticks a period, the hands of the 7 copies fit between each other on belt 1.';
        expect(text(form({ showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffsetNote: note }))).toContain(note);
        expect(text(form({ showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffsetNote: null }))).not.toContain('At about');
        expect(text(form({ showCopyOffset: false, onCopyOffsetChange: () => {}, copyOffsetNote: note }))).not.toContain('At about');
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

    it('shows a step that runs off the four sides as it is', () => {
        expect(text(form({ showCopyOffset: true, onCopyOffsetChange: () => {}, copyOffset: { x: 4, y: -2 } }))).toContain('4 tiles east and 2 tiles north');
    });

    // The field is a controlled Base UI number field whose steppers add the step to the value, take the null of an empty
    // field as 0, and keep the result within min. Called as a function, the form is its element tree, so the field's own
    // props can be read and the steps applied to them without a DOM.
    const fieldOf = (copyOffset: CopyOffset | undefined, onCopyOffsetChange: (value: CopyOffset | undefined) => void) => {
        const tree = TargetOutputForm({ recipe: 'grenade', itemsPerSecond: 240, copies: 7, counts: 'made', machinesMax: null, recipeNames: ['grenade'],
            onRecipeChange: () => {}, onItemsPerSecondChange: () => {}, onCountsChange: () => {}, onCopiesChange: () => {},
            copyOffset, showCopyOffset: true, onCopyOffsetChange });
        const found: ReactElement<{ id?: string; value: number | null; min: number; step: number; onValueChange: (value: number | null) => void }>[] = [];
        const walk = (node: ReactNode) => {
            if (Array.isArray(node)) node.forEach(walk);
            else if (isValidElement<{ id?: string; children?: ReactNode }>(node)) {
                if (node.props.id === ELEMENT_IDS.targetCopyOffset) found.push(node as never);
                walk(node.props.children);
            }
        };
        walk(tree);
        expect(found).toHaveLength(1);
        return found[0].props;
    };

    /** The form at `offset`, then the field stepped by `direction` (the arrow keys and the buttons both do this) */
    const stepped = (offset: CopyOffset | undefined, direction: 1 | -1): CopyOffset | undefined => {
        let result = offset;
        const field = fieldOf(offset, (value) => { result = value; });
        const next = typeof field.value === 'number' ? Math.max(field.value + direction * field.step, field.min) : Math.max(0, field.min);
        field.onValueChange(next);
        return result;
    };
    const typed = (tiles: number | null): CopyOffset | undefined => {
        let result: CopyOffset | undefined;
        fieldOf({ x: 12, y: 0 }, (value) => { result = value; }).onValueChange(tiles);
        return result;
    };

    it('steps up and down from a typed value, and never empties by stepping', () => {
        const eleven = typed(11);
        expect(eleven).toEqual({ x: 11, y: 0 });
        const twelve = stepped(eleven, 1);
        expect(twelve).toEqual({ x: 12, y: 0 });
        expect(stepped(twelve, -1)).toEqual({ x: 11, y: 0 });
        // down from 3 stops at 1 tile: 0 tiles is the empty field, which the up arrow could not leave
        let offset: CopyOffset | undefined = { x: 0, y: -3 };
        for (let press = 0; press < 5; press++) offset = stepped(offset, -1);
        expect(offset).toEqual({ x: 0, y: -1 });
        expect(stepped(offset, 1)).toEqual({ x: 0, y: -2 });
    });

    it('steps up from an empty field to 1 tile, on the side it shows', () => {
        expect(typed(null)).toBeUndefined();
        expect(stepped(undefined, 1)).toEqual({ x: 1, y: 0 });
    });
});
