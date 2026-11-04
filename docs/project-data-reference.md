# Local project metadata reference

`POST /project-data/inspect` accepts one multipart `.3mf` file. The entire HTTP request has a 16 MiB limit. Inspection creates no Hive request, executes no embedded G-code, and does not expand mesh geometry.

The extractor reads Bambu project metadata in `Metadata/project_settings.config` and `Metadata/model_settings.config`. Optional `Metadata/plate_N.json` and `Metadata/slice_info.config` supply saved usage candidates. Plate numbers come from the model settings, not a guessed plate 1.

The response contains the uploaded filename, its exact SHA-256, actual plate numbers, the project palette with original zero-based source slots, per-plate usage candidates, and warnings. Unknown or incomplete palette entries remain unselectable. Missing plate metadata is an error.

## Saved usage

Plate JSON uses zero-based `filament_ids`. Slice XML uses one-based filament IDs and one-based plate indices. The extractor joins datasets by actual plate number and preserves source identities. Duplicate colors remain separate source slots.

Valid saved usage initially filters and preselects the candidates. The UI still requires confirmation because saved metadata can be stale or overinclusive. Missing, malformed, conflicting, out-of-range, or unsupported mixed-filament metadata produces the full palette with no assumed usage. Object extruder assignments and `filament_maps` do not establish complete plate usage. The extractor does not decode painted triangles.

## Rejected archives

Inspection rejects malformed ZIPs, unsafe or duplicate paths, encrypted entries, symbolic links, more than 1,000 archive entries, invalid JSON, XML DTDs or entities, and XML deeper than 64 levels or larger than 64,000 elements. Each metadata document has a 4 MiB limit on actual inflated bytes. All read metadata together has a 16 MiB limit.

## Bound mappings

A confirmed project has a filename, SHA-256, and plates. Each plate contains a unique positive `number` and source filaments with a unique zero-based `sourceSlot`, a material type, a six-digit hex color, and an optional name.

The browser sends selected plate numbers and `plateMappings`, with one mapping group per plate and one entry per confirmed source filament. The backend stores one source snapshot and separate catalog-ID requirements and idempotency keys for each plate. `mappings[].materialId` is a Hive catalog UUID, distinct from `sourceSlot`. The backend verifies the filename and source bytes again before submission. Hive resolves material and color during creation. Stored orders from earlier sample versions retain their original requirements for retries. Confirmation never approves Hive inspection holds.

## Saved preview limits

The extractor reads `Metadata/plate_N.png` for the exact plate number. A declared `thumbnail_file` must agree with that path. Previews are opaque PNG data, never mesh rendering or executable SVG. Each image has a 512 KiB limit, dimensions at most 2048 by 2048, and an 8 MiB combined read budget. Missing, invalid, oversized, and mismatched images become `null`; the plate stays selectable. The browser also falls back if PNG decoding fails.

Preview data stays in the inspection response and never enters persisted print intent or the order payload. Mapped JSON previews retain the 64 KiB request limit. Legacy single-plate `mappings` requests and shared typed-filament CLI orders remain supported. A changed wire shape under an existing order ID conflicts; replay the unchanged input to recover old work.
