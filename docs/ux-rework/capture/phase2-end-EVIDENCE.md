# Phase 2 fresh review evidence — 2026-10-16

Product: `3115caf106f0c0c0894ca448700553325413217b`, byte-identical to Phase 2
`29fd922bab24394a17ecc08e952503782d9f5880` across UI, engine and sidecar. The changes accompanying this note
are capture scripts and documentation only. [Build-card evidence](build-card-EVIDENCE.md) records the full local
gates, independent test/build repeat and item-specific accessibility/geometry checks; those remain valid for this
unchanged product. This note records the additional fresh phase walkthrough, not a complete AA certification.

## Fresh captures

Root ran the scripts against the immutable production preview on port 5274, using that checkout's UI and engine
samples. Required main widths were 1440, 960, 720 and 390; extra widths were 1440 and 390.

| Run | Result | Evidence |
|---|---|---|
| Full main walkthrough, four widths | 28 PASS / 0 FAIL / 0 failed steps | `/tmp/ux-phase2-end/capture.log`, `shots/INDEX.md` |
| Full extra walkthrough, two widths | 6 / 0 / 0 | `/tmp/ux-phase2-end/capture-extra.log`, `shots/extra/INDEX.md` |
| Main 1440 after dialog timing correction | 7 / 0 / 0 | `/tmp/ux-phase2-end/dialog-rest-main.log`, `dialog-rest-shots/INDEX.md` |
| Extra, both widths after timing correction | 6 / 0 / 0 | `/tmp/ux-phase2-end/dialog-rest-extra.log`, `dialog-rest-shots/extra/INDEX.md` |

Root opened the actual images and found the initial confirm-import dialog almost transparent during entry. The
first two runs therefore did not provide reviewable evidence for every dialog despite their passing checks. Both
scripts now await actual finite modal/backdrop animations and require opacity 1 before direct-dialog shots; they
do not disable animations or alter product paint. Rest logs record zero unfinished finite animations and opacity 1.
All previous checks/actions are retained. The original 287 evidence files, scripts and logs are preserved with a
verified SHA-256 manifest under `/tmp/ux-phase2-end/pre-dialog-rest-20261016/`.

Final assembled review index: `/tmp/ux-phase2-end/review/INDEX.md`. It uses the new 1440 and extra images and the
unchanged fresh 960/720/390 images. Root confirmed the old/new 1440 filename sets match, opened all three corrected
Paste states, both main/narrow clock help states, and fresh 720 Results / 390 Configure images. Original indexes
and raw runs remain available. No screenshots are committed.

## Capture reconciliation

- Updated navigation and state contracts: enabled Generate explains and focuses the first problem; Diagram beta,
  Build/Advanced, Details/Developer tabs, actual named diagram nodes and clock click/touch help.
- Preserved build-file rejection in Paste and the genuine confirm-import state. The valid input reuses the existing
  first-visit script's sidecar-format conversion of the logistic sample verbatim. It is explicitly a **test input**,
  not a captured in-game export. Parser, workers, engine results and sidecar are unchanged.
- Added eight shared ui selectors without changing action helpers. Both walkthroughs use real Configure/Results
  clicks and retain reachability failures; no forced-click fallback, assertion removal, axe exclusion or suppression.
- Syntax, named imports and ui bindings passed before execution. Adopted files match the executed runtime hashes:

| File | SHA-256 |
|---|---|
| `capture.mjs` | `136da52ad93f17f6118e95009052128f5f0c5dcb899bc7762ad6e12a7c660e57` |
| `capture-extra.mjs` | `ecee87383770c508d2945888c265ac1d07bd4f3772cc4d171c668c4303841a5b` |
| `lib.mjs` | `cb8e69992d2695d5625ca73da683f3a8e31a6fe606715dff2cddccb4b73edcbf` |

Detailed mappings, patches, archive hashes and commands: `/tmp/ux-phase2-end/CAPTURE-CHANGES.md` and
`ADOPTED-HASHES.json`.

## Boundaries and remaining checkpoints

The historical half-width run remains **775 PASS / 9 FAIL**, all nine matching the recorded 390 baseline; this new
walkthrough does not relabel that whole run PASS. Full desktop/half-width geometry support begins at 720, with main
actions and view reachability required below it. Nongeometry accessibility findings and the 320px reflow policy
conflict remain explicit review/retro topics.

Three fresh independent Sol/high/fast-off persona reviews are running on these actual images. Their verdicts and
the phase retro are pending. The owner's 2.2 sidecar check already passed; 2.5 A's in-game install check still holds
the phase PR. Owner approval is required before the phase merges into feature. No phase/final approval is implied
by the capture results or the earlier helper-text approval. Deferred D1–D8 remain discussion drafts.
