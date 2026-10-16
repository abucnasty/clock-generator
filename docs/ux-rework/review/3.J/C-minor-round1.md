# Phase 3 review C — additive 3.J affected-persona recheck

**Verdict: PASS.** C3E-1 is fixed. The affected saved-run belt wording now distinguishes the run’s setting from the selected clock’s requirement. I found no new defect in this bounded presentation change. The original independent Phase 3 review at `/tmp/ux-phase3-end/C-r16-FULL.md` remains unchanged; this report adds the dispositions below.

## Scope and identity

I read `/tmp/ux-p3-integration/docs/ux-rework/specs/3.J-result-copy.md`, the complete `/tmp/ux-phase3-result-copy-review/DIFF.patch`, and affected actual source in `/tmp/ux-phase3-result-copy-verifier`. The reviewed product is `bca47c8d666178f37f8dbb9334e1379812ef9e3a`, UI tree `74bcbf9db4ea3f90f84a1867f061fb831edfbfca`, unchanged engine tree `81e2f2279361387d3141a14e53e147d37288c3d4`.

The supplied diff against `7433d6c` changes only two UI utility implementations, their two existing test files, and two existing capture consumers. It changes display formatting and wording, without changing event calculations, selection, saved-run lifecycle, engine arithmetic, or layout rules. I read no other current recheck or formal report, operated no browser/app, ran no tests or Git commands, and made no product changes. The only write is this authorized additive report.

## Findings and dispositions

| Finding | Disposition | Evidence and judgment |
|---|---|---|
| **C3E-1 — raw Fuel floating-point noise** | **Fixed** | I opened the current actual720 PNG `/tmp/ux-phase3-result-copy-native-fuel/w720/03-fuel-events-and-trace-text-720-part5of6.png` and read its matching ARIA. Both show **“82.094 items burned (fuel amounts rounded for display)”**, replacing `82.09359999999995`. The single inline qualifier makes the display rounding honest without repeating it for every quantity. `clock-generator-ui/src/utils/fuelAccessibility.ts:40` formats continuous quantities through the established `formatNumberText` with `maxDecimals: 3`. |
| **Original C26 — noisy display numbers, affected Fuel remainder** | **Fixed for this remainder** | The new Fuel prose now follows the established display-number approach. The formatter’s existing small-nonzero branch at `utils/numberText.ts:50` uses significant digits when ordinary decimal rounding would produce zero. This recheck does not silently close other original C26 scope or unrelated retained engine prose. |
| **Saved-run belt wording versus selected standing-only alternative** — related to the original C4/C5/C7 interpretation and snapshot boundaries | **Fixed for the cited copy problem** | I opened `/tmp/ux-phase3-result-copy-native-standing/w720/01-standing-alternative-saved-moving-setting-720.png`, read matching ARIA and `CURRENT-COPY.json`. The selected clock’s tile says **“Standing still”** while the distinct line says **“This run used your Moving belt setting.”** Full card text explicitly says the selected clock is made for belts that stand still; its native radio is checked. The capture records exact RAW unchanged. This stops the old “These clocks assume…” line from inaccurately describing every alternative as sharing the run’s setting. |
| **Exact Fuel events and timing equivalence** — original C2/C2E-2 closure boundary | **Retained** | The current ARIA exposes all six events, each for16 items, with start/end pairs `1–12`, `385–396`, `577–588`, `961–972`, `1345–1356`, and `1729–1740`. The current index records six chart events matching six text rows. The diff leaves `fuelEventRows`, interval construction, duration/empty tick counts and sampled-interval qualifications unchanged. Display rounding does not alter event-table values. |

No new blocker, major, minor or nit is raised in this affected recheck. No additional product fix is requested by this report.

## Why the saved-run wording is accurate

The changed strings in `utils/beltQuestion.ts:26` and `:28` describe **the run’s stored setting**. They no longer purport to describe the condition of every clock found during that run. Source still reads `beltAssumption` from `generatedFor?.beltQuestion` in `App.tsx:600`, and passes that saved assumption to the existing Results line at `App.tsx:1157`. The selected clock continues to supply its own belt label and explanation.

The native standing-alternative evidence establishes the relevant mixed context directly: a standing-only selected clock from a run whose saved setting is Moving. I do not substitute the cancel capture’s selected-Moving state for that proof. The screenshot is a framed observation, not a new keyboard/focus proof; the matching ARIA, full card text, checked native radio and unchanged RAW establish the copy/state relationship.

The standing-setting variant is also accurate in the inspected source: **“This run used your Backed up and standing still belt setting.”** This specific recheck’s selected-standing screenshot does not independently exercise that saved-standing variant.

## Verification provenance and limits

- Current bounded native Fuel evidence records **108 PASS / 0 FAIL / 0 failed steps**, and selected-standing evidence records **23/0/0**. I inspected the actual relevant PNGs and ARIA rather than inferring the result from totals alone.
- The gate receipts under `/tmp/ux-phase3-result-copy-checks/gates/RESULTS.json` show test, lint, default Knip, icon and build completion with exit0. Root’s independent repeat receipts show test/build exit0; its actual test log records **1295 tests / 80 files passed**, unchanged in count. Existing assertions were updated rather than adding a new test file or permutation suite.
- The source receipt identifies the exact product/UI/unchanged-engine trees above and412 assets. Current preview identity is recorded in `/tmp/ux-phase3-result-copy-checks/repeat/PREVIEW-IDENTITY.json`. I did not independently rerun the application or HTTP verification.
- The original broad r16 **8002/0/0** and supplement **8043/0/0** remain **preceding-source evidence**. They are not a fresh full capture of this postfix. The bounded current evidence and the small inspected diff support this minors-only recheck under the approved3.J procedure.
- No unrestricted AA certification, new native race claim, assistive-technology session, human-usability result or new gameplay verification follows from these checks.

## Unchanged carries and boundaries

The original C3E-2 through C3E-8 remain as reported: menu-dismissal page-position movement, passive320 Exclude-chip clipping, first-visit route guidance, repeated explanatory density, repeated alternative labels, the source-confirmed swing-comparison shape weakness, and the LCM double negative. Approval of Phase4 work does not close them.

The original limits also remain: the native pending-Undo critical interval was not exercised; native1440 Fuel had three visible ring bands with the fourth separately observed; additional native busy input and painted busy-tooltip states were unsampled; baseline menu-scroll parity was established only at390; historical negative runs remain negative. This text-only correction does not reopen or claim new verification of those unaffected behaviors.

D1–D7 and first-visit refinement remain approved future work, D8 remains investigation only, and D9 still requires an independent audit **and actual justified cleanup of UX-added UI tests before feature→master**. No report-only or post-release carry satisfies that hard requirement.
