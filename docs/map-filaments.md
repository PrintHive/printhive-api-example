# Map a project's filaments

1. Choose a project 3MF and wait for extraction.
2. Choose a plate from the extracted plate numbers.
3. Review **Source filaments used on this plate**. Use **Show all project filaments** to correct stale saved metadata.
4. Click **Use these source filaments**.
5. Search the Hive catalog for each source filament and select a result. Catalog presence does not establish printer compatibility or loaded inventory.
6. Review the selected catalog UUIDs in the mapping cards.
7. Click **Preview API request**. Check the source slots, resolved material and color, and optional target data before submission.

The browser sends the selected UUIDs in `mappings` during submission. The resolved preview does not include those UUIDs.

If you already have authoritative per-plate usage, open **Advanced: supply known plate data**. Import or paste this JSON, then click **Use project data**:

```json
{
	"plates": [{
		"number": 1,
		"filaments": [{ "sourceSlot": 0, "material": "PETG", "color": "#39FF14" }]
	}]
}
```

Keep source indices from the original project. Confirm each plate separately. Changing a confirmation clears that plate's catalog selections. Loading another file clears all selections. The backend binds project data to the filename and SHA-256 of the uploaded bytes.

To request placement on a named printer, expand **Optional placement on a named printer**. Supply both API AMS ID and API slot ID, or leave both empty for Hive to resolve the route. AMS IDs 254 and 255 require slot 0. Do not derive placement from source slots. Use a new order ID to change a stored hint.

See the [local metadata reference](project-data-reference.md) for archive limits and saved-usage rules.
