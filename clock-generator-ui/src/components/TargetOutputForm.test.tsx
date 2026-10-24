import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TargetOutputForm } from './TargetOutputForm';
import { copyOffsetOf, copyOffsetShown } from '../utils/copyOffset';

const text = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const form = (props: Partial<Parameters<typeof TargetOutputForm>[0]> = {}) => renderToStaticMarkup(
    <TargetOutputForm recipe="grenade" itemsPerSecond={240} copies={7} machinesMax={null} recipeNames={['grenade']}
        onRecipeChange={() => {}} onItemsPerSecondChange={() => {}} onCopiesChange={() => {}} {...props} />);

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
});
