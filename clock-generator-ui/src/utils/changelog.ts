interface Release {
    version: string;
    date: string;
    sections: { title: string; items: string[] }[];
}

/** Parses the `## [version] - date` / `### Section` / `- item` structure of CHANGELOG.md */
export function parseChangelog(markdown: string): Release[] {
    const releases: Release[] = [];
    for (const line of markdown.split('\n')) {
        const release = line.match(/^## \[(.+?)\](?:\s*-\s*(.+))?/);
        if (release) {
            releases.push({ version: release[1], date: release[2] ?? '', sections: [] });
            continue;
        }
        const current = releases[releases.length - 1];
        if (!current) {
            continue;
        }
        const section = line.match(/^### (.+)/);
        if (section) {
            current.sections.push({ title: section[1], items: [] });
            continue;
        }
        const item = line.match(/^- (.+)/);
        if (item) {
            if (current.sections.length === 0) {
                current.sections.push({ title: '', items: [] });
            }
            current.sections[current.sections.length - 1].items.push(item[1]);
        }
    }
    return releases;
}

/** The versions that list at least one entry: an empty `## [Unreleased]` heading is not shown as a version of its own */
export function releasesWithEntries(releases: Release[]): Release[] {
    return releases.filter(release => release.sections.some(section => section.items.length > 0));
}
