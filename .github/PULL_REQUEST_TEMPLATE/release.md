## Overview

{two to four lines: what this release changes for the user, by area (simulation, generation, blueprint, ui)}

## Shipped

{one line per merged pull request, from `git log --first-parent --format='- %s' <last tag>..`}

**Version and date:** {generator version and sidecar version, the changelog section dated}

## Checklist

- [ ] UAT on the preview of `master`: {who tested which builds, and when}
- [ ] Generator bumped in `clock-generator` and `clock-generator-ui`, with both lock files
- [ ] Changelog section dated
- [ ] Record unchanged: the pull request changes no file in `clock-generator/record/`
- [ ] Sidecar bumped in `info.json` and `changelog.txt`, or not shipping

## Impact

**Door:** {two-way | one-way: what cannot be undone}
**Affects:** {whose builds, saved configs, or none}
