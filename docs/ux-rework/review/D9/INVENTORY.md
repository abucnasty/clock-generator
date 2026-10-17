# D9 inventory at the integrated provider reconciliation

Status: initial cleanup implemented and reviewed; all currently integrated later-provider test changes reconciled below. Combined gates, exact-head review/CI and any future test additions remain OPEN. Assessed by a fresh implementer who authored none of the assessed tests.

Integrated before-cleanup baseline: `9d88162`, tree `5580fbd0ab7650d81ccd4e55cbf39aa2129d3f90`; all six accepted product providers are integrated. This inventory covers 86 current UI test files; it does not claim a new executed case count. File blobs below bind this before source; the root's cleanup merge supplies after identities. Initial standalone cleanup before source was `6899860`; historical evidence remains in EVIDENCE.md.

## Attribution

I independently confirmed plan inception `f934af689050a97015b92e1cbef596619beb2e82` has sole parent `cd1666bba8abfd47d534055aa3197624f4113632`, changes only UX docs, and precedes every reachable nonmerge UI-test-changing source through this milestone. All such sources descend from that plan. Today's master merge-base was not used.

The [historical attribution ledger](/Users/abucnasty/.codex/artifacts/ux-phase4-planning-20261016/D9-HISTORY-ATTRIBUTION/ELIGIBLE-INVENTORY.json), [baseline reasoning](/Users/abucnasty/.codex/artifacts/ux-phase4-planning-20261016/D9-HISTORY-ATTRIBUTION/BASELINE-ATTRIBUTION.md), and [initial coherent-group/case bindings](/Users/abucnasty/.codex/artifacts/ux-phase4-planning-20261016/D9-INDEPENDENT-AUDIT/DECISIONS.json) remain the detailed source/PR and declaration record. The 62 still-unchanged file blobs match that frozen audit; the remainder are traced through the initial and later source deltas below. I read the actual cleanup targets and named survivor assertions, and inspected every later test-source delta; I did not infer deletion eligibility from a file being new.

Later reachable test changes are UX-authored: `3f08a2b` (startup/recovery/model/geometry/cache compatibility), `e6e3b0e` (near-lane reselection), `930feb7` (geometry edit protection/recovery unavailable), and `3896c2c` (Results/import assumptions, preferences, belt grouping and rate wording). PR #210 merge `fb680f0` takes all ten changed test blobs exactly from parent 2. No merge through the initial milestone produces a novel UI test blob relative to both parents. Source/parent patches: [history](/tmp/ux-p4-d9-attribution/HISTORY.patch), [frozen-to-milestone diff](/tmp/ux-p4-d9-attribution/SINCE-FROZEN.patch), [parent log](/tmp/ux-p4-d9-attribution/LOG.txt).

External upstream 0.16 release `97350be` (#205) changes only UI package manifests, no UI tests. The earlier external imports likewise add no UI test history per the historical ledger; engine tests are excluded. Compatibility UI tests written on the UX line are eligible, retained behavior—not external upstream tests.

Mixed-file boundaries remain exact: usePersistedConfigForm protects 4 baseline declarations, configMapping 6, edits 37, formConfig 4. A TypeScript AST attribution read compared all 51 protected whole call-expression texts before/after: all unchanged. At integrated source `9d88162`, eligible declarations in these files move 4/4/23/5 → 4/4/21/4; only C10/C23 delete declarations. D10 adds one independently retained configMapping conversion case. A fresh AST read against integrated before-source again confirms all 51 protected call-expression texts unchanged; eligible mixed declaration lines move 445 → 433. configForm/inserterFix's adapted baseline case is protected; its new 0.16 assertions are retained intact. filterSlots→inserterFilters is migrated UX coverage; C14 transfers every unique migrated outcome.

## Coherent group disposition

All groups/cases in the detailed initial binding remain KEEP unless named C01–C24 in [DECISIONS.md](DECISIONS.md). The table covers every current file, its source lineage and protected behavior. Source abbreviations resolve to full SHAs/PRs in the linked history ledger; later source commits are pinned above.

| UI src path | Before blob | UX test source commits | Disposition and protected behavior |
|---|---|---|---|
| components/CheckPlanSection.test.ts | `6520f1408a35` | 2d31cc5 | KEEP; Exclude continuity across own edits, running/valid/invalid, cancel, no-op and replacement |
| components/ConfigImportExport.test.ts | `96aa1c9df247` | 2d31cc5,3896c2c | KEEP; Preview-bound consent and one Undo for selective Paste |
| components/ManualBlueprintDialog.test.ts | `4591fca8eec9` | 2d31cc5 | KEEP; Post-MUI focus recovery and other-dialog ownership |
| components/OverridesForm.test.ts | `ca16c36961f4` | 2d31cc5 | KEEP; Advanced switch semantics and persistent numeric-input descriptions |
| components/TransferPlanPanel.test.ts | `6ae96f4cc6aa` | 2d31cc5,a9ed34b | KEEP; Editable/checking/read-only Swing Plan mutation boundary |
| components/colors.test.ts | `592699eb871d` | ef36474,52455d2 | KEEP; State/item contrast, distinct status swatches, deterministic palette and legend |
| components/entityTypes.test.ts | `5aa0938abe9f` | b97ab33 | KEEP; Localized entity type with sentence-case and unknown fallback |
| hooks/useBuildMutation.test.ts | `9d10406885d9` | 5bbd059 | KEEP; Authoritative mutation ownership, synchronous whole-build Undo and delayed initial-data switchback rejection |
| hooks/useBuildViewContext.test.ts | `5a5057ee36a7` | a9ed34b | KEEP; Matching owner/form/cache hydration, replay, identical-form build switching and guarded once-only position restoration |
| hooks/useCopyBlueprint.test.ts | `a5db60b1ed4f` | 2d31cc5 | KEEP except C01; Clipboard failure snapshot, stale confirmation, late callbacks, pinning and feedback timer |
| hooks/usePersistedConfigForm.test.ts | `c02b48fb8acd` | 139f21d,f157eb3,39fdc41,1d955b2 | KEEP except C02; Saved form migration, forced flag and fractional/metadata document roundtrip |
| hooks/useResolvedColorScheme.test.ts | `f0b506441ac6` | 52455d2 | KEEP; System/explicit mode resolution, live media listener ownership/cleanup and denied-media fallback |
| hooks/useSimulationWorker.test.ts | `321f53d7e14d` | 865f460,3f08a2b,5bbd059 | KEEP; Worker startup failure, repair, check resend and stale-response settlement |
| theme/contrast.test.ts | `24b79183ca76` | 38e23dc | KEEP except C03; Contrast formula, AA threshold boundaries, alpha blending and parsing |
| theme/theme.test.ts | `12308feb0082` | 38e23dc,52455d2 | KEEP except C04; Actual MUI role contrast, overlay, text color, focus ring and token wiring |
| theme/tokens.test.ts | `0f9e9f851515` | 38e23dc,52455d2 | KEEP except C05; Contrast of every documented token pair and completeness of protected surfaces |
| utils/a11yLabels.test.ts | `24ceb8192b43` | dc5dcb6,38e23dc,c95d964,18f1bed | KEEP except C06; Accessible row/filter/lane/help name formatting |
| utils/advancedSummary.test.ts | `b4e6e04e30f4` | 869318b,3f08a2b | KEEP; Advanced active setting count excluding belt question and inactive fields |
| utils/beltQuestion.test.ts | `17b3482010ef` | bbcd758,c95d964 | KEEP; Belt question eligibility, answer canonicalization, run identity and standing-belt hint |
| utils/buildChanges.test.ts | `33f405e99649` | 865f460 | KEEP; Build change names, deterministic order and bounded changed-field summary |
| utils/buildFlowGraph.test.ts | `c6616d30ec3e` | 6f1fbd4,b97ab33 | KEEP; Directed diagram edges, split entity identity, loop layout, Tab order and readable names |
| utils/buildLibrary.test.ts | `8f2d224c4920` | 39fdc41 | KEEP; Library migration/recovery, version safety, active tab choice, naming and cross-tab conflicts |
| utils/buildViewContext.test.ts | `5d733381c9e6` | a9ed34b | KEEP; Per-build storage isolation, safe-value recovery, regenerated UUID identity and unavailable route fallback |
| utils/bulkEdit.test.ts | `01c6f35809d2` | 18f1bed | KEEP; UUID selection/ranges, mixed value comparison, labels and item union |
| utils/checkErrorText.test.ts | `296e9e94c859` | 733e117 | KEEP except C07; Capacity error translation with next steps and unknown-message passthrough |
| utils/checkThenGenerate.test.ts | `82ffd2db77cf` | d608b5a,e18124c,7c6d1f8,865f460 | KEEP except C08; Check/Generate precedence, key dependencies, state labels and pending request settlement |
| utils/clockSummary.test.ts | `df30428d596d` | 733e117,c95d964,8fa2c15,3f08a2b,930feb7 | KEEP except C09; Clock name priority, recovery qualification, total/one-copy scope, belt facts and comparison |
| utils/configForm/configMapping.test.ts | `e1d2c2b910e9` | 139f21d,f157eb3,c8ba1dd,5bbd059 | KEEP; Engine/form mapping and imported omitted-vs-explicit inserter metadata |
| utils/configForm/edits.test.ts | `494d3c29dbe1` | 139f21d,f157eb3,869318b,4b86e77,18f1bed | KEEP except C10; Renumber/reference integrity, forced rules, duplicate deep copy and bulk selected updates |
| utils/configForm/inserterFix.test.ts | `794e71568eb3` | f157eb3,930feb7 | Baseline declaration protected; 0.16 assertions KEEP; Pre-existing missing-inserter fixes |
| utils/copiesProblem.test.ts | `16a903589ce4` | c8ba1dd | KEEP; Copies field agreement with actual engine schema and focus target |
| utils/deeperSearch.test.ts | `6b80d3c3300a` | 42d00d9,869318b | KEEP; One-run deeper search, form-key parity and persistent/searching notices |
| utils/developerTools.test.ts | `5bac802c75a0` | c95d964 | KEEP; Debug URL token detection, saved preference and malformed query fallback |
| utils/displayPreferences.test.ts | `3a5bef67d929` | 3896c2c | KEEP; Versioned browser density/scheme defaults, independent persistence and denied-storage recovery |
| utils/drillsSection.test.ts | `8976f8144443` | 869318b | KEEP; Drill-section folding while focused and focus departure |
| utils/enableControlDraft.test.ts | `1a36da475684` | 139f21d,4446e34 | KEEP except C11; Rule draft reconstruction, saving omitted/conditional/clocked values and dirty-state detection |
| utils/enableRuleLabel.test.ts | `e186e10ae1ef` | 6c797be,f157eb3,9505213 | KEEP; Readable enable-chip mode/window/condition summaries and accessible whole-rule names |
| utils/entityLabel.test.ts | `d3efe19ad650` | f157eb3 | KEEP; Canonical entity labels across entity kinds |
| utils/exampleBuilds.test.ts | `7f89ea425caf` | f664556 | KEEP; Example manifest structural validation, fractional Copies and names/counts |
| utils/firstProblem.test.ts | `6c89489d412a` | 5d929dc,d608b5a,f664556,e18124c,b97ab33,c8ba1dd,dbb5551 | KEEP except C12; Problem ordering, capacity arithmetic deferral, focus targets and bar-note precedence |
| utils/fuelAccessibility.test.ts | `2551c30db0b8` | 2d31cc5 | KEEP; Fuel event table parity, rounded quantities, exact duration and sampled empty intervals |
| utils/gameNames.test.ts | `b8c711b12b49` | 52de68d,b97ab33 | KEEP; Localized names, safe own-property lookup, search rank, ambiguity and typed-ID fallback |
| utils/glossary.test.ts | `c2364f5f09d4` | c95d964,5614c03,8fa2c15 | KEEP; Approved glossary membership, factual wake-up source, focus subsets and references |
| utils/headerOverlap.test.ts | `397380c95b8a` | 7c6d1f8 | KEEP except C13; Whether focus overlaps the header, exact edge and offscreen handling |
| utils/inserterDraft.test.ts | `cdc74b380e92` | 139f21d,4b86e77 | KEEP; Diagram draft changed-field diff, lane deep comparison and omission semantics |
| utils/inserterFilters.test.ts | `c5170b95520a` | 4b86e77 | KEEP except C14; Automatic/explicit filter set/remove semantics and no-hole preservation |
| utils/inserterMetadata.test.ts | `cb5ce81a2f5c` | c8ba1dd | KEEP; Effective engine inserter capacity, missing/unknown metadata and display help |
| utils/inserterOptions.test.ts | `d11edb5c10b4` | 4b86e77 | KEEP; Shared list/diagram endpoint options, localization and Automatic stack clearing |
| utils/installSteps.test.ts | `c32c25f00853` | 733e117 | KEEP; Installation sequence, clock/no-clock/drill/book routing and complete wiring list |
| utils/introCard.test.ts | `ffa729d44990` | f664556 | KEEP except C15; Blank-build detection and first-visit persistence/forced redisplay |
| utils/messages.test.ts | `0783c1482859` | 73799be,7c6d1f8,af60471 | KEEP; Message replacement, duration, callback ownership and live-region speech races |
| utils/nearLane.test.ts | `6b134a6cd1e8` | 6f1fbd4,e6e3b0e | KEEP; Nearest belt lane eligibility, set/clear semantics and file/list/diagram parity |
| utils/nextStep.test.ts | `a8fd570bc9df` | 38e23dc | KEEP except C16; One next action by result freshness, running/problems and visible Results copy |
| utils/numberText.test.ts | `fa9340b208ed` | d6ee6d8,6f1fbd4,c95d964,c8ba1dd | KEEP; Numeric display vs edit precision, rate scope and min/max clamping |
| utils/pastePreview.test.ts | `5716a0c4afef` | 2d31cc5,3f08a2b | KEEP; Selective Paste raw counts and reference crossings |
| utils/pasteTarget.test.ts | `7dc8699ecf19` | f664556 | KEEP; Suggested target never exceeds maximum and raw floating noise is handled |
| utils/pickerOrder.test.ts | `3f26781ac339` | 4b86e77 | KEEP; Priority entity IDs and per-group ranked search |
| utils/rateWarning.test.ts | `b388f7e1e99d` | 5d929dc,865f460,3896c2c | KEEP; Copy labels for stale/running/below-target states and printed shortfall threshold |
| utils/recommendedClock.test.ts | `93c6f0e0c69c` | 42d00d9,9505213,c95d964,865f460,3f08a2b,3896c2c | KEEP; Engine pick parity, recommendation explanation facts and stable/hidden row identity |
| utils/repeatedUnitsProblem.test.ts | `e8870fec250c` | c8ba1dd | KEEP; Actual repeated-unit CopiesError structure and manual recovery arithmetic |
| utils/resultsCache.test.ts | `c95455d4b4ab` | 865f460,3f08a2b | KEEP; Cancel restoration, complete-vs-stopped precedence, LRU/pinning, lean storage and selection |
| utils/resultsStaleness.test.ts | `3ca8fb1edb9b` | 6f6ceae,f157eb3,bbcd758,b97ab33,1d955b2,865f460 | KEEP; Config identity, edit/revert, metadata and stale warning snapshot |
| utils/resultsStore.test.ts | `e29deaa2b423` | 865f460,3f08a2b | KEEP; Memory store put/get/metadata, completed-run protection, eviction and oversized fallback |
| utils/rowFocus.test.ts | `ed5b7b651b2d` | 73799be | KEEP; Focus successor after delete, last row and empty list |
| utils/ruleProblems.test.ts | `ba10348067fa` | 4446e34 | KEEP; Rule field validation, timing bounds, release/group IDs and warnings |
| utils/ruleSentence.test.ts | `c25167ed0c74` | 4446e34 | KEEP; Rule prose reflects operators, nested conditions, latch and blueprint semantics |
| utils/ruleTemplates.test.ts | `30f5273ceb70` | 4446e34,1d955b2 | KEEP except C17; Template endpoint applicability, actual rule construction/schema, defaults and replacement counts |
| utils/ruleTiming.test.ts | `45b7ddeeed85` | 4446e34 | KEEP; Timing source precedence and editable planned-window conversion |
| utils/scrollEdges.test.ts | `0e618939198a` | 96a69c7 | KEEP; Overflow edge detection with subpixel rounding and corresponding fade side |
| utils/shareLink.test.ts | `a58337abc00f` | 39fdc41,1d955b2 | KEEP except C18; Share compression, size/stream limits, version/parser recovery and editable config roundtrip |
| utils/sidecarExport.test.ts | `f7ff67f6f0ba` | f664556 | KEEP; Sidecar import format discrimination, legacy shape and empty/invalid recovery |
| utils/sidecarGuide.test.ts | `cc30992fb71b` | f664556,c8ba1dd | KEEP; Sidecar entry instructions and friendly entity-index/file errors |
| utils/targetRateLimit.engine.test.ts | `da8f92ee40a2` | c8ba1dd | KEEP; UI capacity agrees with actual engine schema/arithmetic validation |
| utils/targetRateLimit.test.ts | `da315cbf451b` | e18124c,c8ba1dd | KEEP; Machine capacity discovery, conservative displayed ceiling and unsupported arithmetic deferral |
| utils/timelineGeometry.test.ts | `7418545875e9` | ef36474 | KEEP except C19; Visible minimum timeline marks, clamping, pixel snapping and paint priority |
| utils/undoKeys.test.ts | `228c76a81718` | 73799be,7c6d1f8 | KEEP; Undo shortcut ownership in text fields/dialogs and Escape routing |
| utils/undoSnapshot.test.ts | `b32dd7497cdc` | 73799be,f664556,865f460,869318b,18f1bed | KEEP; Whole-form Undo, immutable snapshot, forced rules, renumbering and bulk restoration |
| utils/wakeWindowCopy.test.ts | `db89ae5a75e7` | de57ec7,cfca81f,b97ab33 | KEEP except C20; Wake-window narration, whole summary, sampled row facts and watch-note thresholds |
| utils/wakeWindows.test.ts | `5613fbec9ca0` | de57ec7,b97ab33 | KEEP except C21; Inclusive/wrapped window geometry, slack, row modes, pointer/keyboard and axis marks |
| utils/workflowAnnouncement.test.ts | `e3b8aae4edc2` | 24c8d77,d608b5a,9505213,733e117,865f460 | KEEP; Workflow live speech ordering, quiet focus changes, Cancel and restored selection |
| worker/engineClient.test.ts | `02a9863d97f7` | baseline | EXCLUDE baseline; Pre-existing engine query crash/startup/fetch failures |
| worker/formConfig.test.ts | `a8601951525f` | c8ba1dd,1d955b2,3f08a2b,930feb7 | KEEP except C22,C23; Editable Copies refinement without structural-validation bypass |
| worker/installFacts.test.ts | `16fe18818fa3` | 733e117 | KEEP except C24; Blueprint installation facts and drill fallback grouping |
| worker/pool.test.ts | `6df9c9a3a2f2` | 865f460 | KEEP; Worker busy/replace/check-resend/crash decisions |
| worker/requestGate.test.ts | `5d3165d7912b` | 865f460 | KEEP; Ready-gate queued request order and fail/later-waiter rejection |
| worker/simulation.worker.test.ts | `7382774ce8cf` | 5bbd059 | KEEP; Real-engine typed Check/plan/conversion query recovery and proof/check/query failure separation |

## Later additions assessed at this milestone

- useSimulationWorker's new complete/cancel/restore assumption ownership case: KEEP; prevents later form flags rewriting historical result claims. Pure cache tests cannot replace the real hook sequence.
- clockSummary's sampled-start counts, rate/recovery separation and unavailable recovery: KEEP; distinguishes factual engine outcomes that older verdict fixtures conflated. C09 touches only the independent Copies scope table.
- geometry/fuel/explicit-override form roundtrip, mixed-drop recovery, Paste category replacement, near-lane reselection and protected automatic fixes: KEEP; prevents geometry corruption or draft loss across actual transports and edit paths.
- advancedSummary's explicit false/zero: KEEP; absence differs from deliberately disabled/start-seed-zero settings.
- resultsCache/resultsStore assumption fixtures: KEEP; equality/lean-storage tests now preserve new worker facts, without additional permutations.
- displayPreferences's three groups: KEEP; malformed/version/field fallback, browser-only roundtrip and blocked-storage are distinct policies.
- belt grouping after global eligibility: KEEP; original indexes, recommended ordering, selected hidden exceptions and cross-group leakage are meaningful composition contracts.
- prospective import assumptions: KEEP; asserts actual incoming vs retained draft ownership and zero mutation as selection/current form changes.
- numerical mismatch vs failed hold: KEEP; actual above-target rounding does not establish a failed hold check.

## Integrated later-provider source reconciliation

The initial milestone's open provider inventory is now reconciled through `9d88162`. Parent-aware reads of every newly reachable UI-test change identify four additional UX-authored source commits: `dbb5551` (first visit), `52455d2` (theme), `5bbd059` (D10), `a9ed34b` (D7). The accepted providers' later product fixes introduce no further test changes. Integration commits `0d818d1`, `2fae0c7`, `6a4d93e`, and `9d88162` retain the corresponding provider test blobs exactly from parent 2; none creates a novel test resolution. The Results integration's test blobs likewise match parent 2 and were already assessed at the first milestone. No upstream test addition or baseline case is misattributed.

- **First visit — KEEP** the adapted barNoteOf case in firstProblem: the default blank build names the three routes; explicit manual entry points to Recipe; busy/empty-problem suppression remains. This is a meaningful route policy, not another Boolean cross-product. IntroCard's C15 five literal scenarios remain unchanged by the first-visit provider.
- **Theme — KEEP** three resolver/listener/denied-media cases, actual semantic chart contrast/identity, per-mode theme wiring/identity and all live light/dark contrast pairs. Each actual pair protects a colour criterion; expanded case count is not a deletion reason. C04 retains the overlay assertion. C05 still removes only token format spelling; the sole D9 merge conflict was resolved to import tokenPairsFor and omit SURFACE_HOVER, preserving the complete two-mode pair table.
- **D7 — KEEP** both hook hydration/queued-position cases and three pure storage/identity cases, plus TransferPlanPanel's disclosure-hook fixture adaptation. Matching build/form/cache readiness, effect replay, pre-ready navigation, identical-form switching, explicit/native cancellation, independent storage/deletion, unsafe values, UUID regeneration and changed/renumbered occupant fallback are distinct failure boundaries. Native focus/geometry are outside these source stubs' proof.
- **D10 — KEEP** both authoritative mutation/Undo/load ownership cases, the typed Check/run recovery race case, canonical conversion application/UUID/forced metadata and corrupt-payload rejection, and the real-engine worker Check/plan/query/proof/refusal/error boundary case. The pure engine plan, public worker path and authoritative UI state ownership protect different contracts; no duplicate quantity matrix was added.

Detailed source-bound dispositions were retained before integration in [LATER-PROVIDERS.md](/tmp/ux-p4-d9-attribution/LATER-PROVIDERS.md). This refreshed table now binds their actual integrated before blobs, including D7/D10 integration adaptations. No new tests were introduced by the merge or this reconciliation.

## Completion boundary

All currently reachable eligible UI test changes through `9d88162` have dispositions. Final combined gates and independent CODE/UX final-delta review PASS; final root evidence is in EVIDENCE.md. Exact-head CI is shown in PR211; landing awaits owner approval. Any subsequent test or helper edit must be scanned again before final feature→master; this author milestone alone cannot mark D9 complete.

