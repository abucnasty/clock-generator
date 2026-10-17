# D9 cleanup evidence — integrated reconciliation

## Integrated author HOLD

Integrated before-cleanup source `9d88162`, tree `5580fbd0ab7650d81ccd4e55cbf39aa2129d3f90`, contains the accepted Results, Configure, first-visit, theme, D10 and D7 providers. Root is merging cleanup `4bef645`; the resulting commit identity is root-owned and pending.

- Current UI test files: 86 → 86; physical test lines 10632 → 10444 (-188).
- UX-new files against attributed pre-rework baseline: 80 → 80; their complete source lines 9370 → 9197.
- Eligible mixed-file AST declaration lines, excluding all 51 protected baseline declarations: 445 → 433. Combined disjoint eligible source proxy: 9815 → 9630. Baseline-owned inserterFix assertions remain conservatively excluded from this proxy and unchanged by cleanup.
- The original 24 decisions and source-derived 57-case reduction survive. New integrated executed counts/runtime are PENDING root execution; the historical 1305 → 1248 result below must not be presented as the combined suite count.
- The only conflicted test hunk was the tokens import. Resolution retains tokenPairsFor, drops unused SURFACE_HOVER and preserves every live light/dark pair assertion. C04's overlay-only case and C05's source-format removal remain intact. No new test case or extra contrast audit was added.
- A fresh read of every later test source and merge parent establishes the KEEP decisions in INVENTORY.md: first-visit dbb5551, theme52455d2, D10 5bbd059 and D7 a9ed34b. All integration test blobs match provider parent2; no novel test resolution or upstream test addition was introduced.
- Root's current owner-adopted keyboard and colour criteria profile governs product evidence; this source reconciliation makes no full-AA certification claim. Existing actual colour-pair tests remain useful regression protection. Functional gates and independent reviews remain required.

Root's preliminary combined compile/lint passed; default knip then identified only the obsolete exported WAKE_SELECTED_COLOR and SLACK_BACKGROUND declarations in WakeWindowsChart. Root explicitly adopted their exact deletion and orphan-comment removal in the D9 spec. Repository-wide identifier inspection found no remaining caller: mode-aware runtime colours now supply selection/slack, and C20 removed the raw-source scanner. Deleted those two declarations/comments only; live bar/track exports, forced-colour constants and actual runtime palette values remain intact. No dummy consumer, exclusion or unused private constant was added. Preserve the initial knip diagnostics and compare emitted assets after this integration-only deletion as well as the earlier visibility-only changes.

Author status: READY/HOLD. Root must freeze the resolved merge, run full combined gates and independent repeat, bind before/after emitted assets and comparable runtime receipts, and request independent CODE/UX final-delta review. No new runtime, browser or CI PASS is claimed by this author. Future UX test edits still require a final scan before release.

## Historical first cleanup milestone

Author status: HOLD for root verification/reviews. This is actual test cleanup, not report-only delivery. Final D9 release status remains OPEN.

- Before source `68998602a74b7c8bad7801d5401ec7236da71aae`; after is the root-created cleanup commit.
- Scope: 23 existing UI test files plus the three D9 evidence files, followed by the two internal declaration visibility changes described below. No runtime value/behavior, engine, capture, helper, framework or configuration change.
- Current UI test files: 81 → 81; total physical test lines 10145 → 9957 (-188).
- Files absent at attributed pre-rework baseline: 75 → 75; their complete UX-added source lines 8922 → 8749. These exclude every pre-existing file.
- Eligible test declaration lines within the four mixed files, counted with TypeScript AST whole call expressions, excluding all 51 protected declarations: 411 → 399. This measure excludes shared helpers/imports and is not total mixed-file diff size.
- Combined disjoint eligible source proxy (new-file lines + eligible mixed declaration lines): 9333 → 9148. New 0.16 assertions added inside the protected inserterFix declaration are retained and conservatively omitted from this proxy.
- Source-derived expanded case reduction: 57. Executed test counts are pending root's matching-environment benchmark.
- Root owns all Git mutations, gates, builds, browser work, benchmark execution and independent reruns. This author executed no tests/build/server/browser/CI operation and claims none passed.

Attribution/static author inspection: read-only Git parent/blob/history comparisons, SHA256 frozen-binding comparison, TypeScript AST extraction for protected declaration identity and eligible-line counts. All 51 protected declarations unchanged. Root-supplied later patches were checked against direct parent/blob reads. [INVENTORY.md](INVENTORY.md) and [DECISIONS.md](DECISIONS.md) bind every disposition and survivor.

## Verification still required

Root records immutable before/after source/engine/dependency/runner/cache identities; actual per-run test result/duration; full UI test/lint/knip/check:icons/build; required independent test/build repeat; exact-head CI; independent code+UX reviews. CI duration comparison is unavailable to this author. Fewer source cases do not prove a runtime or CI improvement.

Product captures can be reused only if root verifies production source identity apart from tests/evidence; final fresh phase captures and all three phase-end personas remain required. Any failure retains diagnostics and routes back to this author for bounded fixes.

Final reconciliation remains open for theme/D10/D7, first-visit and any subsequent UX-added tests, then the implemented reviewed cleanup must land in feature before the owner performs feature→master.

## Initial root checks and visibility-only follow-up

Initial cleanup commit `4704b61`: root reports UI 1248 tests / 81 files, test/lint/icons/build and independent test/build repeat PASS. Before count 1305 is root's matching product report: 57 fewer executed cases, consistent with the source proxy. Comparable timing receipts remain root-owned and pending incorporation; no speed claim is made.

Default knip FAILED on two exports whose only external consumers were removed by C05/C20: `SURFACE_HOVER` at `src/theme/tokens.ts:27` and `WakeWindowsChartProps` at `src/components/WakeWindowsChart.tsx:388`. Preserve the initial failure diagnostics; the failure is not waived.

Root explicitly adopted the D9 spec's two-line internal visibility allowance (canonical spec commit `07bcd85`). Repository-wide identifier inspection found only same-file uses: SURFACE_HOVER remains used by the measured TOKEN_PAIRS, and WakeWindowsChartProps remains the chart function's parameter interface. Removed exactly the `export` keyword from those two declarations. Their values, types, local references and runtime behavior remain unchanged. No dummy consumer, test exclusion or knip setting was added.

Author status: HOLD for root commit and all required gates/reruns. This follow-up changes no test counts or physical test-line proxies. Separate source-bound later-provider KEEP decisions are retained in [LATER-PROVIDERS.md](/tmp/ux-p4-d9-attribution/LATER-PROVIDERS.md); final merged-head reconciliation remains open.


## Root verified first cleanup acceptance

Frozen product `e143cca2071b007005f2d231901721203de83f7a`, before `68998602a74b7c8bad7801d5401ec7236da71aae`. Full UI test/lint/default knip/check:icons/build PASS; independent own-engine test/build repeat PASS. Executed workload: 1305 → 1248 tests, 81 → 81 files. Root verified all 412 emitted production files byte-identical across before/after, including both visibility-only changes. Full receipts: `/tmp/ux-p4-d9-checks-r1/{SOURCE,RESULTS,BENCHMARK}.json`; independent repeat `/tmp/ux-p4-d9-repeat-r1/RESULTS.json`. Initial knip-negative source4704b61 retained separately in `/tmp/ux-p4-d9-checks-r0`.

Comparable sequential local `npm test` pair after both own-source installs/builds/gates, no cache flush: before4.612s command wall (Vitest4.15s), after2.672s (Vitest2.25s). One local pair only, without a runtime or CI speed guarantee; CI timing comparison unavailable. Exact runner/cache qualifications and actual logs are in BENCHMARK.json. This directly measures fewer executed cases; product assets match exactly.

Independent CODE/UX reviews and exact-head CI remain pending. Final later-provider integration refresh remains OPEN. No source-only native boundary is promoted to browser PASS.

Initial independent CODE and UX round0 both PASS without blocker/major. Reports are retained beside this note. They assessed all24 decisions and actual survivors; CODE independently confirmed51 protected declarations plus11 untouched baseline declarations. No formal fix round used. Final provider merge/conflict and later-test reconciliation plus exact-head CI remain open, so this does not close D9 release acceptance.
