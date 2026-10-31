# Uploaded-project plate extraction proof

The example remains connected to the production API. This proof uses the real browser, local example backend, real 3MF metadata, and production catalog reads. It does not use a fake API or submit a print order.

Selecting a file sends its bytes to local POST /project-data/inspect. The example reads the Bambu plate metadata and project palette and returns the file hash. It does not create a Hive source or job during this step. Selecting the used source filaments is an explicit confirmation for the chosen plate, not an approval of Hive inspection holds.

Run with the example already running on port 3077:

    PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/plate-extraction/repro.mjs
    PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/plate-extraction/run.mjs

Optionally set EXAMPLE_PROJECT to a local customer project path for an additional read-only regression check. The optional check expects the originally reported one-plate, two-filament project; customer bytes are not checked in.

The original reproduction failed before the fix:

    Detected plates after selecting a three-plate project: []
    actual: []
    expected: [ '1', '2', '3' ]

After the fix, it reports actual options 1, 2, and 3. The reported customer project also rendered plate 1 with source slot 0 PETG-CF/black and source slot 1 PETG/white.

The browser proof covers automatic upload/extraction, explicit source-use confirmation, separate plate mappings, original source indices 0 and 2, production catalog selection and the outgoing request preview, invalid-file errors, valid-file recovery, and mobile overflow. A separate delayed-request check confirmed that an old extraction cannot replace a subsequently selected file.

The browser permits only same-origin GET/HEAD, local metadata extraction, and the read-only order preview. Creation, release, cancellation, and direct browser calls to production are blocked. Results report zero unexpected requests, zero JavaScript errors, and no submitted order.

All 28 Node 24 tests pass. They include metadata size, ZIP entry/path/link, XML DTD/structure, malformed files, sparse plate IDs, and incomplete palettes. Independent Sol review approved the fix with no findings.

The final local desktop and mobile videos were reviewed frame by frame, including all 55 desktop frames and 44 mobile frames. Viewport screenshots were used during recording so captures did not resize the video. Media and generated results remain local and are excluded from source control.
