# Map a project's filaments

1. Choose a project 3MF and wait for extraction.
2. Check **Include plate** for each plate you need. Click a saved preview or **Configure plate** to edit that plate. Plates without previews remain selectable.
3. Review **Source filaments used on this plate**. Use **Show all project filaments** to correct stale saved metadata.
4. Search and assign a Hive requirement for each selected source. You can assign before usage confirmation.
5. Click **Use these source filaments**. Confirmation preserves assignments for the sources still in use.
6. To reuse a choice, click **Apply to selected plates using source slot N**. Review the listed target plates. This replaces their material choice for that source, without copying physical placement.
7. To override a plate, open that plate and click **Change requirement**. The change stays on that plate. Catalog presence does not establish printer compatibility or loaded inventory.
8. Review the selected catalog UUIDs in the mapping cards.
9. Repeat usage confirmation for every selected plate. Shared assignment does not confirm usage.
10. Click **Preview API request**. Check each plate's catalog `filamentId`, source slots, resolved material and color, and optional target data before submission.

The browser sends each selected catalog UUID as `plateMappings[].mappings[].materialId`. The resolved preview includes that catalog UUID as `plates[].filaments[].filamentId`, alongside the material, color, and optional placement data.

If you already have authoritative per-plate usage, open **Advanced: supply known plate data**. Import or paste this JSON, then click **Use project data**:

```json
{
	"plates": [{
		"number": 1,
		"filaments": [{ "sourceSlot": 0, "material": "PETG", "color": "#39FF14" }]
	}]
}
```

Keep source indices from the original project. Confirm each plate separately. Changing usage removes only the unchecked source's assignment and placement hint. Reconfirming unchanged usage preserves them. Loading another file clears all selections. The backend binds project data to the filename and SHA-256 of the uploaded bytes.

To request placement on a named printer, expand **Optional placement on a named printer**. Supply both API AMS ID and API slot ID, or leave both empty for Hive to resolve the route. AMS IDs 254 and 255 require slot 0. Do not derive placement from source slots. Use a new order ID to change a stored hint.

See the [local metadata reference](project-data-reference.md) for archive limits and saved-usage rules.

After submission, choose each plate under **Selected plate requests** to inspect its request ID and job. Release or cancel each held request separately. If submission stops partway through, retry the unchanged order to resume with the saved keys.

Bulk copy matches the original source slot, material type, and color within this project. It never groups different source slots just because their colors match. It applies only to the currently selected matching plates; repeat the action for plates selected later. Loading another project clears these choices.
