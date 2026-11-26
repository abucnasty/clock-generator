import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigSchema } from './schema';

/** The descriptions of every lane's `sharing` in the configuration's JSON Schema */
function sharingDescriptions(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) node.forEach(it => sharingDescriptions(it, out));
    else if (node !== null && typeof node === 'object') {
        const properties = (node as { properties?: Record<string, { description?: string }> }).properties;
        if (properties?.sharing?.description !== undefined) out.push(properties.sharing.description);
        Object.values(node).forEach(it => sharingDescriptions(it, out));
    }
    return out;
}

describe('the sharing of a lane', () => {
    it('is described for the lanes the copies take from and those they drop onto', () => {
        const descriptions = sharingDescriptions(z.toJSONSchema(ConfigSchema, { unrepresentable: 'any' }));
        expect(descriptions.length).toBeGreaterThan(0);
        for (const description of descriptions) {
            expect(description).toBe('shared (default): all copies take from or drop onto this lane. per_copy: each copy has a lane of its own.');
        }
    });
});
