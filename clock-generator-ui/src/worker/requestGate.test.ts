import { describe, expect, it } from 'vitest';
import { createReadyGate } from './requestGate';

describe('createReadyGate', () => {
    it('resumes the requests that waited before open() in the order they came', async () => {
        const gate = createReadyGate();
        const order: number[] = [];
        const waiting = [1, 2, 3].map((n) => gate.whenOpen().then(() => order.push(n)));
        await Promise.resolve();
        expect(order).toEqual([]);
        gate.open();
        await Promise.all(waiting);
        expect(order).toEqual([1, 2, 3]);
    });

    it('lets a request through at once after open()', async () => {
        const gate = createReadyGate();
        gate.open();
        let ran = false;
        await gate.whenOpen().then(() => { ran = true; });
        expect(ran).toBe(true);
    });

    it('rejects every waiter and every later whenOpen() once it has failed', async () => {
        const gate = createReadyGate();
        const early = gate.whenOpen();
        gate.fail(new Error('no data'));
        await expect(early).rejects.toThrow('no data');
        await expect(gate.whenOpen()).rejects.toThrow('no data');
    });
});
