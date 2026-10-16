# Phase 4 First-visit route refinement
Findings: owner first-visit A/A · Implementer model: gpt-6.1-sol/high, fast off · Branch: feat/ux-rework-p4-first-visit

## Change
- Put short purpose copy first, then immediate Paste from Factorio / Try an example / Build by hand choices; Paste remains primary.
- Move complete Sidecar/export instructions behind an on-demand guide, preserving full content/mod link and clipboard manual recovery.
- Initial hint describes routes; recipe-specific guidance appears after choosing Build by hand.

## Files
- `src/components/IntroCard.tsx:50–99`: current purpose→long steps→routes becomes purpose→routes→labeled guide disclosure. Keep `SidecarModLink`/`SidecarCopySteps` exports or extract them to new `SidecarGuide.tsx` and update consumers together. `PasteFromFactorioDialog.tsx:5,45–50` imports those existing components and must retain complete instructions in recovery.
- `utils/sidecarGuide.ts:15–46` authoritative copy/mod URL/steps; `hooks/useIntroCard.ts:17–39` existing dismissal/manual/forced state; `utils/introCard.ts:7–52` focus/dismissal helper; `App.tsx:221–230,975–982` entry wiring/focus; `firstProblem.ts:139–159` hardcoded blank manual hint; `WorkflowBar.tsx:221–254` note presentation. `ConfigImportExport.tsx:62–67,346–400` existing route handle/clipboard/example route reused.
- Capture ui map and affected first-visit/clipboard consumers updated together. D1A final header/import seam is prerequisite because same App/WorkflowBar/ConfigImportExport portions are involved; D2/D7 can overlap if file edits reconcile.

### Small state/API extension
Expose existing `builtByHand` value from `useIntroCard` (no new persistence key). Define `type EntryRoute = 'routes' | 'manual'` only if needed by bar copy. Extend `barNoteOf` input with optional `entryRoute?: EntryRoute`; blank+routes returns neutral route sentence with no false recipe target; blank+manual retains existing recipe next step. Actual problemsOf/Generate/Check validation unchanged. Route hint proposed copy: “Start with Paste from Factorio, try an example, or build by hand.” Guide label: “How to export with the Sidecar mod”. Existing purpose statement remains accurate; root can shorten within glossary without changing product claims.

## Acceptance criteria
- [ ] First card immediately exposes three routes after purpose; no guide expansion/wizard required first. Only Paste uses filled primary/confirmation styling appropriate to existing one-filled-action policy. All routes reachable from normal header/menu if intro dismissed, and Getting started reopens it.
- [ ] Guide defaults closed on intro show and exposes all existing preparation/copy/generate/copy/wire instructions and mod link/Factorio requirement on demand. Label is a real keyboard control with expanded state/associated region; native activation visibly opens content and focus stays safe. No instruction silently deleted or added in contradiction of current Sidecar data. Recovery dialog retains complete copy steps without requiring a hidden intro to be opened.
- [ ] Before a route is chosen neutral next step describes routes; choosing Build by hand hides intro for this visit, focuses actual recipe input and switches to recipe guidance. Dismissal alone is not a claim that manual route was chosen. Reopening Getting started and Reset preserve existing remembered-dismissal/manual-reset behavior. Missing recipe still blocks Generate/Check under actual validation, whatever neutral hint says.
- [ ] Paste uses current handle/clipboard validation and selected-category review; permission denied, empty/not-JSON/build-file/unsupported export routes keep existing manual text-box recovery and visible reason. No clipboard retry loop or new import subsystem. Try example opens existing chooser and respects replacement/Undo; Build by hand does not modify unrelated data just to switch route.
- [ ] Intro unmount, route destinations, guide dismissal and failed Paste preserve safe visible focus (existing cleanup at IntroCard:54–63 and handleBuildByHand flushSync focus retained). Native Enter/Space/pointer prove correct visible destination and no body/hidden focus fallback. Short height/narrow width do not trap controls below sticky overlays.
- [ ] Imported/selected results/builds/Undo, chosen clock/cache, display preferences and full manual recovery unaffected. No forced wizard, compulsory acknowledgment, repeated in-game installation check or new owner-test checkpoint.

## Tests
Reuse introCard/sidecarGuide/firstProblem and clipboard route coverage. Update actual blank-hint behavior test and add only a meaningful route→manual guidance/focus regression if not protected. Do not add tests of static order/copy permutations; native capture verifies immediate routes, guide and focus. D9 includes any additions.

## Screens to capture
Common gate 1440/720/390; first purpose/routes collapsed guide, expanded full guide/mod link; Paste success review then denied clipboard manual recovery; example chooser then imported destination+Undo; manual route with recipe guidance/focus; dismissal then Getting started; Reset with manual/remembered-dismissed state. Short-height guide/recovery focus and actual visible activation responses. Reuse existing actual safety outcomes where source/state match.

## Risks and checkpoints
Guide extraction must update PasteFromFactorioDialog imports without losing copy/recovery. Neutral hint is presentation only; avoid weakening validation or presenting disabled Generate as ready. D7 context must not auto-open a stale unsaved intro route/draft. All common gates/reviews/three phase-end personas/owner merge checkpoints remain.

Root adopts this bounded contract against the committed Results/header source, stacked on its current head. Runtime display provider exports remain unchanged; the context interface is private. First-visit owns only Intro/useIntro/route hint and small App callback wiring, preserving Results header/detail, D10 conversion and D1B row ownership. No wait for the complete Results review or theme palette is required; all checks/reviews still precede merge.
