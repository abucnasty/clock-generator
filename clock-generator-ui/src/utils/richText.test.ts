import { describe, expect, it } from 'vitest';
import { richTextParts } from './richText';

describe('richTextParts', () => {
    it('splits the first line of an inserter\'s combinator into words and icons', () => {
        expect(richTextParts('[entity=car] → machine 1 [recipe=iron-plate] [item=iron-ore] (inserter 1)')).toEqual([
            { kind: 'icon', icon: 'entity', name: 'car' },
            { kind: 'text', text: ' → machine 1 ' },
            { kind: 'icon', icon: 'recipe', name: 'iron-plate' },
            { kind: 'text', text: ' ' },
            { kind: 'icon', icon: 'item', name: 'iron-ore' },
            { kind: 'text', text: ' (inserter 1)' },
        ]);
    });

    it('reads a quality on an icon, and a quality on its own', () => {
        expect(richTextParts('[item=iron-plate,quality=rare] [quality=legendary]')).toEqual([
            { kind: 'icon', icon: 'item', name: 'iron-plate', quality: 'rare' },
            { kind: 'text', text: ' ' },
            { kind: 'icon', icon: 'quality', name: 'legendary' },
        ]);
    });

    it('leaves a tag it does not draw as the text it is, in one part with the words around it', () => {
        expect(richTextParts('Open [virtual-signal=signal-clock] 4–9 [fluid=water]')).toEqual([
            { kind: 'text', text: 'Open [virtual-signal=signal-clock] 4–9 ' },
            { kind: 'icon', icon: 'fluid', name: 'water' },
        ]);
    });

    it('puts a line with no tag back as it is, and an empty line as no part', () => {
        expect(richTextParts('Part of the clock: do not wire or change.')).toEqual([{ kind: 'text', text: 'Part of the clock: do not wire or change.' }]);
        expect(richTextParts('')).toEqual([]);
    });

    it('leaves brackets that are not a tag alone', () => {
        expect(richTextParts('[ ] [entity=] [=car] a[b')).toEqual([{ kind: 'text', text: '[ ] [entity=] [=car] a[b' }]);
    });
});
