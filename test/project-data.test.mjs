import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectData, validateMappedInput, resolveMappedInput } from '../src/project-data.mjs';
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const projectData = { filename: 'part.3mf', sha256: 'a'.repeat(64), plates: [
  { number: 2, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#000000' }, { sourceSlot: 3, name: 'Accent', material: 'PETG', color: '#FFFFFF' }] },
  { number: 7, filaments: [{ sourceSlot: 5, material: 'PETG-CF', color: '#111111' }] },
] };
const input = { plates: [2], projectData, mappings: [{ sourceSlot: 3, materialId: idB }, { sourceSlot: 0, materialId: idA }] };
test('per-plate source data preserves original nonconsecutive indices and variants', () => {
  assert.deepEqual(validateProjectData(projectData).plates.map((p) => p.filaments.map((f) => f.sourceSlot)), [[0, 3], [5]]);
  assert.equal(validateProjectData(projectData).plates[1].filaments[0].material, 'PETG-CF');
  assert.throws(() => validateMappedInput({ ...input, plates: [7] }), /every source filament/);
  assert.throws(() => validateMappedInput({ ...input, plates: [2, 7] }), /exactly one/);
  assert.throws(() => validateMappedInput({ ...input, plates: [1] }), /absent/);
});
test('duplicate slots, missing colors, invalid mappings and unbound project data are rejected', () => {
  const source = projectData.plates[0].filaments[0];
  for (const value of [null, { plates: [] }, { plates: [{ number: 1, filaments: [source, source] }] }, { plates: [{ number: 1, filaments: [{ ...source, color: 'black' }] }] }]) assert.throws(() => validateProjectData(value));
  assert.throws(() => validateMappedInput({ ...input, projectData: { ...projectData, sha256: 'missing' } }), /bound/);
  assert.throws(() => validateMappedInput({ ...input, mappings: [input.mappings[0], input.mappings[0]] }), /once/);
  assert.throws(() => validateMappedInput({ ...input, mappings: [{ sourceSlot: 0, materialId: 'SKU-123' }, input.mappings[0]] }), /valid Hive filament ID/);
});
test('selected catalog IDs resolve locally into identity records and ID-only requirements, without any catalog read', () => {
  const resolved = resolveMappedInput({ ...input, filaments: [{ material: 'injected' }] });
  assert.deepEqual(resolved.filaments, [{ sourceSlot: 0, filamentId: idA }, { sourceSlot: 3, filamentId: idB }]);
  assert.deepEqual(resolved.catalogSelections, [{ sourceSlot: 0, id: idA }, { sourceSlot: 3, id: idB }]);
  assert.equal(resolved.projectData.sha256, 'a'.repeat(64));
  assert.throws(() => resolveMappedInput({ ...input, mappings: [input.mappings[0]] }), /every source filament/);
  assert.throws(() => resolveMappedInput({ ...input, plates: [1] }), /absent/);
  const upper = resolveMappedInput({ ...input, mappings: [{ sourceSlot: 3, materialId: idB.toUpperCase() }, { sourceSlot: 0, materialId: idA }] });
  assert.equal(upper.filaments[1].filamentId, idB.toUpperCase());
});
test('explicit named-printer placement hints preserve their own AMS indices, independent of source order', () => {
  const mapped = { ...input, printer_id: 'mock-printer', mappings: [{ sourceSlot: 3, materialId: idB, targetSlot: { ams_id: 2, slot_id: 1 } }, { sourceSlot: 0, materialId: idA }] };
  const result = resolveMappedInput(mapped);
  assert.deepEqual(result.filaments, [{ sourceSlot: 0, filamentId: idA }, { sourceSlot: 3, filamentId: idB, targetSlot: { ams_id: 2, slot_id: 1 } }]);
  assert.throws(() => validateMappedInput({ ...mapped, printer_id: undefined }), /named printer/);
  for (const targetSlot of [null, {}, { ams_id: 0 }, { ams_id: -1, slot_id: 0 }, { ams_id: 256, slot_id: 0 }, { ams_id: 0, slot_id: 4 }, { ams_id: 254, slot_id: 1 }, { ams_id: 0, slot_id: 1, extra: 2 }])
    assert.throws(() => validateMappedInput({ ...mapped, mappings: [{ ...mapped.mappings[0], targetSlot }, mapped.mappings[1]] }), /Placement hint/);
  assert.deepEqual(validateMappedInput({ ...mapped, mappings: [{ ...mapped.mappings[0], targetSlot: { ams_id: 255, slot_id: 0 } }, mapped.mappings[1]] }).targetSlots.get(3), { ams_id: 255, slot_id: 0 });
});
