# D9 first cleanup author milestone

Author status: HOLD for root verification/reviews. This is actual test cleanup, not report-only delivery. Final D9 release status remains OPEN.

- Before source `68998602a74b7c8bad7801d5401ec7236da71aae`; after is the root-created cleanup commit.
- Scope: 23 existing UI test files plus the three D9 evidence files. No product/engine/capture/helper/framework/config changes.
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

