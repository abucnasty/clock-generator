import { describe, expect, it } from 'vitest';
import { developerToolsInitial } from './developerTools';

describe('developerToolsInitial', () => {
    it('turns the tools on for a debug parameter', () => {
        expect(developerToolsInitial('?debug', null)).toBe(true);
        expect(developerToolsInitial('?foo=1&debug', null)).toBe(true);
        expect(developerToolsInitial('?debug=1', null)).toBe(true);
    });

    it('does not take another parameter for it', () => {
        expect(developerToolsInitial('?debugger', null)).toBe(false);
        expect(developerToolsInitial('?foo=debug', null)).toBe(false);
    });

    it('keeps the setting kept from the last visit', () => {
        expect(developerToolsInitial('', 'true')).toBe(true);
        expect(developerToolsInitial('', null)).toBe(false);
        expect(developerToolsInitial('', 'false')).toBe(false);
    });

    it('lets the address win over a kept "off"', () => {
        expect(developerToolsInitial('?debug', 'false')).toBe(true);
    });

    it('reads a malformed address without throwing', () => {
        expect(developerToolsInitial('?debug=%E0%A4%A', null)).toBe(true);
        expect(developerToolsInitial('?%', null)).toBe(false);
    });
});
