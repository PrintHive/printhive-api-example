# Plate usage filtering and swatch proof

This proof checks the new metadata parser and UI without creating, releasing, or cancelling an order. It uses a synthetic metadata-only fixture, not printable geometry. That fixture describes eight project palette entries and saved plate hints: plate 2 has source indices 1, 4 and 7; plate 7 has distinct black source indices 0 and 3.

The default runner starts a temporary read-only example instance. Catalog reads are forwarded to the existing production-connected example on port 3077, so the catalog data is real. It supplies no dummy key and reads no credential. Creation/status/control routes are blocked in the temporary instance. The instance and its temporary directory are closed after the test.

Run with a production-connected example available:

    PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/plate-colors/run.mjs

After the primary example has been restarted with the new backend, set EXAMPLE_URL=http://127.0.0.1:3077 to verify that instance directly. The browser still permits only GET/HEAD, local metadata extraction, and the read-only request preview.

Verified checks include default filtered hints, Show all, retaining explicitly selected extras in the filtered view, separate plate state, duplicate-color identities, missing-usage fallback, and swatches for source candidates, source cards, catalog choices, chosen requirements, copyable JSON preview, and the optional data editor. The mobile viewport has no horizontal overflow.

All 34 Node 24 tests pass, and independent Sol review approved the change. The final desktop and mobile exports were reviewed frame by frame, covering all 46 desktop frames and 32 mobile frames. Results contain zero unexpected browser requests, zero JavaScript errors, and no submitted order.

These UI results do not claim that the primary server has been restarted, that saved slice hints describe current geometry, or that any file is qualified for physical printing. Missing/conflicting usage keeps the full palette available. Confirmation and Hive's existing inspection holds remain in force. Local recordings and generated results are excluded from source control.

After credential access was restored, the primary production-connected example on port 3077 was restarted and checked directly. The live browser verified plate 2 filtering to indices 1, 4 and 7, plate 7 filtering to indices 0 and 3, Show all revealing eight entries, source/catalog/selection/preview swatches, and the actual production-catalog-backed request preview. No order was submitted and no JavaScript errors occurred. The sanitized local result is retained under data/production/plate-colors-live.json.
