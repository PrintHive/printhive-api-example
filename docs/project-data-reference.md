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

The browser sends one selected plate and one mapping per confirmed source filament. `mappings[].materialId` is a Hive catalog UUID, distinct from `sourceSlot`. The backend verifies the filename and source bytes again before submission. It reads catalog material and color server-side and persists the resolved requirements for retries. Confirmation never approves Hive inspection holds.
