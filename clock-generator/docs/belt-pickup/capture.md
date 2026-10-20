# Pickup capture and configuration boundary

[Belt pickup documentation](README.md)

A manually configured belt pickup defaults to straight-belt geometry. An imported pickup is a different claim:
its capture must explicitly identify a model the current engine supports. A default or a newer version number
cannot supply facts that the old capture omitted.

## Physical layout

`source.pickup_layout` identifies the approach, separately from moving/backed-up supply:

| Layout | Exposed reach | Meaning |
| --- | --- | --- |
| `side-straight` | 1 tile | Side pickup from an ordinary straight belt; the manual default |
| `side-entrance` | 0.5 tile | Beside an underground entrance |
| `side-exit` | 0.5 tile | Beside an underground exit |
| `front-entrance` | 0.5 tile | Downstream, facing back into an entrance |
| `front-exit` | 0.5 tile | Downstream, facing back into an exit |
| `over-hood-exit` | 0.5 tile | Upstream, reaching across an exit's hood |

Layout supplies `pickup_length` when length is omitted; an explicit conflicting length is rejected. Manual
half-tile configs without a layout must choose one. The UI offers these choices for each belt-fed inserter.
An old Sidecar underground capture becomes unclassified and requires recapture; selecting a default cannot
supply the missing physical fact. Sidecar recognizes the centered upstream exit approach when the inserter faces with belt travel, using
mirroring for lane preference. Other unsupported inline approaches stay unclassified.
The [glossary](glossary.md) illustrates each approach. This field records geometry; the calibrated
[arm-reach model](../simulator.md#picking-up-from-moving-belts-and-underground-endpoints) also uses it to place
each stack relative to the inserter.

## Persistent per-pickup status

Sidecar exports `source.pickup_capture` for each belt-fed inserter. It stays with that source through import,
file export, saved-build reload, sharing, and recording parsing. Top-level `pickup_warnings` remain for the
Sidecar copy window and older import previews; they are not the only copy of the classification.

- `supported`: a positive model declaration, currently `model: "belt"`, with `model_version: 2`, native
  `entity_type`, and the matching layout, reach and preferred lane.
  Version 1 straight-belt captures remain valid; version 1 underground captures require recapture.
- `unsupported`: Sidecar identified a geometry or supply outside the engine's calibrated models. Its reason,
  native entity type/name and exporting Sidecar version remain attached. This includes the out-of-scope
  pickups: reason `splitter` for a splitter and `side-loaded` for a belt tile that another belt side-loads onto,
  as one stream or two merging. Recapturing does not make these supported; see the
  [experiment history](experiments.md#side-loaded-pickups-and-merges).
- `unclassified`: a legacy export did not record a positive model declaration. Existing geometry fields are
  retained for inspection, but do not make the capture supported.

Parsing may fill a straight-belt `pickup_length` default for structural compatibility. The persistent capture
status still blocks simulation/generation: that default does not establish support for the physical source.
The same check applies to direct engine inputs, not only the UI. Unverified builds can be imported, saved and
reviewed. Their picker and coverage summary show the unverified state, including with backed-up supply; changing
a dropdown default cannot clear it. Reconfigure the physical input to a supported layout and capture it again,
or recapture when that geometry has an implemented model. Out-of-scope captures (`splitter`, `side-loaded`) show as
not supported instead: only rebuilding the input as a supported layout and capturing it again clears them.

A deliberate geometry edit on an already supported pickup becomes a manual configuration and clears its
capture declaration; it does not fabricate another native capture. Manual configurations and old files with
no surviving import provenance retain the existing explicit/default geometry rules. Manual assumptions do not
establish support for an unsupported source.

## Older mods and saved data

At the Sidecar import boundary, missing model declarations become `unclassified` even if the export names the
current mod version or contains a pickup length. A legacy warning becomes persistent `unsupported` status;
the reason and any known source type are retained. Explicit warnings take precedence over contradictory
supported markers. This normalization runs before defaults in both full config parsing and the pasted-entity
worker path.

Updating the mod does not update data already copied or saved. Update Sidecar and **capture again** to obtain
the newly supported model inputs. A newer generator never automatically promotes an old unsupported capture.
Saved builds exported before this boundary may already have discarded their warnings and Sidecar version.
Those files cannot reliably be distinguished from manual configurations, so their physical provenance cannot
be reconstructed. Review and recapture belt inputs where that distinction matters. Generators older than this
boundary cannot enforce a protocol they do not understand; keep the generator and Sidecar current.

## Adding support later

A new mechanic needs an explicit model name and its required inputs, a capture implementation, and corresponding
engine validation. Unknown model names or format versions are rejected rather than stripped and interpreted
as an existing ordinary-belt model. `sidecar_version` provides provenance and update guidance; it is not a
model-support flag. Add or increment the model format when interpretation or required inputs change.

Regression coverage includes manual defaults; positive declarations; geometry mismatches; old/current/
future-version exports; legacy warnings; unknown future model names/versions; direct simulation refusal;
save/reload and form round trips; editor presentation; and actual Sidecar exports for straight, underground
and unsupported sources, including splitters and side-loaded tiles. Native timing behavior is unchanged.
