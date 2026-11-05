// scripts/scaffold-of.js: the scaffold beside a sample config (its own, else the longest prefix of its name that has one)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scaffoldOf } = require('../../scripts/scaffold-of') as { scaffoldOf: (configPath: string) => string };

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-of-'));
afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));
for (const file of ['advanced-circuit.scaffold', 'lds-240.scaffold', 'lds-240-wide.scaffold']) fs.writeFileSync(path.join(folder, file), '');

describe('scaffoldOf', () => {
    it('is the config name with .scaffold when that exists', () => {
        expect(scaffoldOf(path.join(folder, 'lds-240.json'))).toBe(path.join(folder, 'lds-240.scaffold'));
    });
    it('is the scaffold with the longest stem that is a prefix of the config name at a hyphen', () => {
        expect(scaffoldOf(path.join(folder, 'advanced-circuit-230.json'))).toBe(path.join(folder, 'advanced-circuit.scaffold'));
        expect(scaffoldOf(path.join(folder, 'lds-240-wide-fast.json'))).toBe(path.join(folder, 'lds-240-wide.scaffold'));
    });
    it('is the config name with .scaffold when none matches, for the caller to report as missing', () => {
        expect(scaffoldOf(path.join(folder, 'grenade-240.json'))).toBe(path.join(folder, 'grenade-240.scaffold'));
    });
});
