import { describe, expect, it } from 'vitest';
import { parseChangelog, releasesWithEntries } from './changelog';

const markdown = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.28.0] - 2026-11-07',
    '',
    '### Added',
    '',
    '- generation: a new clock',
    '',
    '## [0.27.2] - 2026-11-05',
    '',
    '### Fixed',
    '',
    '- simulation: a fix',
].join('\n');

describe('releasesWithEntries', () => {
    it('leaves out a version that has no entries, and keeps the ones that have', () => {
        const releases = parseChangelog(markdown);
        expect(releases.map(release => release.version)).toEqual(['Unreleased', '0.28.0', '0.27.2']);
        expect(releasesWithEntries(releases).map(release => release.version)).toEqual(['0.28.0', '0.27.2']);
    });

    it('leaves out a version whose headings have no entries', () => {
        expect(releasesWithEntries(parseChangelog('## [Unreleased]\n\n### Added\n\n### Fixed\n'))).toEqual([]);
    });

    it('shows an Unreleased version that has entries', () => {
        const releases = parseChangelog('## [Unreleased]\n\n### Fixed\n\n- ui: a fix\n\n## [0.28.0] - 2026-11-07\n\n### Added\n\n- ui: a thing');
        expect(releasesWithEntries(releases).map(release => release.version)).toEqual(['Unreleased', '0.28.0']);
    });
});
