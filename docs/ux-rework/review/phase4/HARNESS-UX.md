# Phase 4 custom-harness retirement — independent UX delta review

**PASS — no blocker or major introduced by the cleanup.** Reviewed the current uncommitted delta against `a2485d6` in `/tmp/ux-phase4-review`. Read-only inspection; I changed no repository, product, test, fixture, browser or Git state. Only this requested report is written.

## Independently verified scope

- Exactly **55 `.mjs` scripts / 34,879 source lines** are deleted from `docs/ux-rework/capture`, including the shared library, custom capture/audit runners and self-tests. All **five harness-only JSON fixtures** are deleted. No `.mjs` remains under that capture directory.
- Every tracked changed path is documentation/capture material. `git diff --quiet a2485d6 -- clock-generator-ui clock-generator .github` succeeds: runtime components, keyboard/focus/theme support, ordinary UI/engine/contrast tests, original engine/sample builds, dependencies and CI are unchanged. Searching product/CI paths finds no dependency on the five removed fixture names or retired capture library. `git diff --check` is clean.
- The new phase4 directory contains evidence, independent item reviews, all three fresh persona reports, D8's investigation proposal, static review images and small result/measurement receipts. It does not replace the removed scripts with another executable audit framework.

This fulfills the owner's request to remove the custom full-AA capture/audit harness in the final Phase4 cleanup, before PR readiness. It is an actual reviewable deletion, not merely a promise to stop using the harness. The repository no longer requires maintenance of these selectors, custom focus/paint classifiers or capture fixtures. Historical Markdown and Git retain provenance; old script references do not require the framework to be recreated.

## Acceptance preserved

The active profile still requires keyboard reach/operation, visible focus, logical order, no traps or entirely hidden focus, normal focus return, and non-colour meaning. Text/control/graphic contrast remains4.5:1/3:1 against actual composited paint in Light/Dark. It explicitly avoids claiming full WCAG AA compliance from that subset.

The updated ORCHESTRATOR keeps full UI test/lint/knip/icons/build, full changed-engine unit/generation/lint/knip/build, the independent root repeat, source identity, native targeted workflows/screenshots, independent CODE and UX, and all three fresh phase personas. PLAN keeps four-width fresh review, original finding dispositions, retro/carries and the owner checkpoint. Ordinary regression/contrast tests and existing accessibility features remain. This changes the evidence method and deletes disproportionate disposable automation; it does not waive the retained functional or focused accessibility requirements.

The item UX PASS and three fresh persona PASS reports predate retirement, as requested. The D10 minor fix is closed; the existing menu-position minor and persona A's belt-wording minor remain nonblocking follow-ups. No cleanup-related browser rerun, extra fixture, OS mutation or new tooling is needed because the reviewed runtime/test/CI trees are unchanged.

## Evidence boundaries and closeout

Read `review/phase4/EVIDENCE.md`, HARNESS-REMOVAL, all three persona conclusions and `receipts/D3-repeat.json`. D3 is honestly labeled a bounded actual UI replay with unchanged candidate pins and matching blueprint/canonical-decoded hashes. One A/explanatory720 copy identity is expressly carried from the unchanged result; it must not be described as eight newly executed clipboard reads. Its scroll values are position snapshots from a different observation protocol, not comparable cumulative baseline travel. No measured percentage/time improvement or human usability claim follows from it. The deletion does not justify restoring the old harness to pursue such a claim.

D9's57-case reduction and412 identical assets remain distinct from harness retirement. The measured2.747s→2.729s pair is effectively unchanged; no CI or speed gain is claimed. D8 remains an investigation/proposal, not approval to implement machine rates.

Minor closeout bookkeeping: include **both** A-P4-1 belt wording and the existing menu-position carry in the final evidence/retro/PR summary. Persona A already records the new wording issue, while the inspected EVIDENCE “Known carried minor” section currently names only the menu jump. This is not a product fix request or a reason for another review/tooling round.

Root must still stage/commit the reviewed cleanup and evidence, finish the necessary final checks and exact-head CI, and present the review checkpoint. **Leave PR211 open for the owner; no automatic merge is authorized.** This PASS does not claim those future Git/CI actions have already completed.
