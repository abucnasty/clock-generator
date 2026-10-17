# Phase4 CODE round0: D7, D10 and integrated state ownership

Verdict: **PASS**

Reviewed source: `41cbd15b0c76fa5d6dfb9d54e810e49be330f1b7` in `/tmp/ux-phase4-review`, against accepted compatibility/feature baseline `bbab59a`. Read-only review; no product, repository, harness or Git changes. This report is the only file written.

| Item | CODE verdict | Blocker | Major | Minor | Nit |
|---|---|---:|---:|---:|---:|
| D7 working context | PASS | 0 | 0 | 0 | 0 |
| D10 repeated-unit conversion | PASS | 0 | 0 | 0 | 0 |
| D7 + D10 integrated App seams | PASS | 0 | 0 | 0 | 0 |

## Findings

No actionable correctness, scope, dead-code or keyboard-markup findings in the reviewed scope. No fix is requested. This is a source CODE acceptance, not a claim that the separately required UX/native checks or phase-end review are complete.

## Source review and reasoning

- D10 canonical proof, `clock-generator/src/config/repeated-unit-conversion.ts`: complete namespace/reference validation; machine-free subsystem refusal; full buffer/drill component membership; every inserter assigned; shared constant boundaries distinguished from private aliases; shared drop geometry/export boundaries refused; ordered local witness and explicit equality verification; GCD composite extraction; original array order retained; references remapped once; source and candidate independent; exact rational Copies checks; target recipe/rate untouched. Approximate detector remains a detector, not proof. Candidate ordinary planning remains the worker's independent check.
- Worker query/recovery, `clock-generator-ui/src/worker/simulation.worker.ts:230`: Check and generation use the exact request input; typed recovery attaches only to actual CopiesError; checked conversion separates structural refusal, expected planning refusal and query failure. Unexpected failures still settle the original request without an eligibility capability. The small AssertionError export supports the existing planning failure class without adding a new engine policy.
- Authoritative form owner, `clock-generator-ui/src/hooks/usePersistedConfigForm.ts:294`: synchronous ID/form/revision capture and guarded replacement; callback executes once outside a React updater. Every actual setConfig/show and accepted initialization replacement advances ownership. Changed-then-restored input and metadata-only changes cannot borrow an older Apply capability. Initialization is guarded against intervening library navigation. Existing public build-library semantics are retained.
- Pure form application, `clock-generator-ui/src/utils/configForm/repeatedUnitConversion.ts:20`: checks source key, retained source indexes/IDs/order, explicit ID presence, complete mappings, candidate records and final exported equality. Retained actual rows preserve UUID/forced metadata, globals and nested field presence. No configToFormData recreation, repeated deletion or second detector.
- Merged Apply sequence, `clock-generator-ui/src/App.tsx:804`: checks idle/current capability and active draft ownership, recomputes against captured input, rechecks token/mounted/authoritative ownership, offers exact snapshot Undo only inside successful commit, then runs existing replacement lifecycle. `handleBuildReplaced` retires the request and clears results under the captured old key before arming a fresh committed-owner recheck. The changed token in this success path is intentional; it does not strand pending state because retireConversion clears it.
- Internal recheck, `clock-generator-ui/src/App.tsx:626`: validates only the committed current owner/key; target focus cancels D7 delayed scroll first. A newer edit/Undo/switch/dropped reply cannot complete the old announcement or move current focus. It directly calls validate, never the explicit run paths that withdraw Undo or start Generate. Existing result cache/manual-pick ownership is reused.
- Merged busy/switch seams, `clock-generator-ui/src/App.tsx:565`, `:612`, `:785`, `:876`, `:917`: Check/Generate consult the synchronous conversion busy guard; Cancel invalidates the token; asynchronous Open/Delete retire the conversion before awaiting; whole replacement resets context while ordinary switching saves departure without erasing destination navigation.
- D7 provider, `clock-generator-ui/src/hooks/useBuildViewContext.ts`: context is keyed by named build ID plus replacement revision, independent of result/config-key ownership. Matching readiness token gates layout hydration, and hydrated-owner guards gate passive storage writes. Pending deliberate navigation wins. UUID-free form identity plus canonical entity signature prevent bare numeric-ID/UUID restoration mistakes. Structural edits discard ambiguous selection/offsets. Bounded anchor restoration occurs once, accounts for sticky header and is cancellable by real input or explicit navigation; it never focuses an entity or opens an editor.
- D7 storage/consumers, `clock-generator-ui/src/utils/buildViewContext.ts`: versioned/enum-validated optional storage; bounded known disclosures and anchors; denied/malformed storage falls back safely; only the deleted named build's context is removed. Results/fuel/entity/insight fallbacks use existing owners. Controlled diagram, timeline, comparison, detail and disclosure props persist real existing choices without introducing sorting/filter UI or duplicating cached clocks. Restoring a diagram selection supplies an explicit selected label/outline without opening an unsaved draft. Existing keyboard Enter editing and MUI tab/disclosure patterns remain.

## Tests and checks inspected

Tests protect distinct missing contracts rather than a permutation matrix: complete/shared-free conversion plus real target planning; composite resource/drill/fuel/rule mapping; private versus coupled geometry; detector blind spots/machine-free transfers; exact Copies/schema/order refusal; real worker expected/unexpected failure propagation; pure form payload/metadata mapping; authoritative changed-then-return and initialization ownership; existing hook Cancel/crash/run matching; named-context separation, invalid storage, UUID-regenerated identity, hydration and cancellable restore. No additional test framework, dependency, lockfile or coverage-driven cases were introduced by D7/D10.

Inspected actual exact-source receipts and result lines (not author summaries):

- `/tmp/ux-p4-combined-checks-r0/SOURCE.json`: head matches reviewed41cbd15; clean source; engine dependency resolves inside immutable verifier.
- `/tmp/ux-p4-combined-checks-r0/RESULTS.json`: every recorded command exits0: own engine/UI npm ci, engine build, data copy, UI1376 tests/86 files, engine1075 tests/82 files, generation147 tests/13 files, both lints, both knip runs, icons, final UI build.
- `/tmp/ux-p4-combined-repeat-r0/RESULTS.json`: separate install/own-engine build/data copy plus independent UI test and build repeat all exit0.
- Actual test count lines also inspected in ui-unit.log, engine-unit.log and engine-generation.log.

No commands rerunning tests or browser automation were added by this review, because exacthead full checks and independent root repeat already exist. Native conversion/Undo, keyboard/colour, D3 repeat, fresh persona checks and final PR CI remain root-owned acceptance work; this CODE PASS does not substitute for them. Existing full-AA script limitations are not product findings under the owner's active keyboard-and-colour scope. No harness expansion or merge is requested.

## Narrow post-round0 delta: recovery action emphasis

Verdict: **PASS**; no blocker/major/minor/nit. Independently inspected the uncommitted two-product-file diff against reviewed41cbd15. App blob `5df05205cb9fa8ec48e09f7d8b713ae5eca80a0d`; WorkflowBar blob `102cb8d1356b64aeb06f209b7c398458c73319bf`.

`App.tsx:804` derives conversionIsNextStep only for Configure, idle state, the existing current-full-config available recovery, and a non-crashed Check surface. `App.tsx:1069` passes null only for that presentation state. `WorkflowBar.tsx:35` accepts NextStep|null; its existing strict comparisons at192/194 render both toolbar commit choices outlined when null. The conversion remains the filled next action. Outside this state the prior primary action is retained, and Results' copyIsNextStep input is unchanged. No handlers, disabled logic, request tokens, form mutations, Undo or state ownership change. This fixes the UX emphasis finding without broadening the state machine. Root's planned full UI gate and native changed-state check remain separate evidence; this delta CODE PASS does not claim they have run yet.
