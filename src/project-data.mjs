const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = /^#?[0-9a-f]{6}$/i;
export const materialIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeColor(value) {
  return typeof value === 'string' && hex.test(value.trim()) ? `#${value.trim().replace(/^#/, '').toUpperCase()}` : null;
}
export function validateTargetSlot(value) {
  if (value === undefined) return undefined;
  if (!object(value) || Object.keys(value).length !== 2 || !Number.isInteger(value.ams_id) || value.ams_id < 0 || value.ams_id > 255 || !Number.isInteger(value.slot_id) || value.slot_id < 0 || value.slot_id > 3 || (value.ams_id >= 254 && value.slot_id !== 0))
    throw new Error('Placement hint needs API AMS ID 0–255 and slot ID 0–3; AMS 254 or 255 requires slot 0');
  return { ams_id: value.ams_id, slot_id: value.slot_id };
}
export function validateProjectData(value) {
  if (!object(value) || !Array.isArray(value.plates) || !value.plates.length || value.plates.length > 256)
    throw new Error('Provide project data with between 1 and 256 plates');
  const numbers = new Set();
  const plates = value.plates.map((plate) => {
    if (!object(plate) || !Number.isInteger(plate.number) || plate.number < 1 || numbers.has(plate.number) || !Array.isArray(plate.filaments) || !plate.filaments.length || plate.filaments.length > 256)
      throw new Error('Each plate needs a unique positive number and its source filaments');
    numbers.add(plate.number);
    const slots = new Set();
    return { number: plate.number, filaments: plate.filaments.map((filament) => {
      if (!object(filament) || !Number.isInteger(filament.sourceSlot) || filament.sourceSlot < 0 || filament.sourceSlot > 255 || slots.has(filament.sourceSlot) || typeof filament.material !== 'string' || !filament.material.trim() || filament.material.length > 100 || !normalizeColor(filament.color) || (filament.name !== undefined && (typeof filament.name !== 'string' || filament.name.length > 200)))
        throw new Error('Source filaments need unique zero-based slots, material types and six-digit hex colors');
      slots.add(filament.sourceSlot);
      return { sourceSlot: filament.sourceSlot, ...(filament.name ? { name: filament.name } : {}), material: filament.material.trim(), color: normalizeColor(filament.color) };
    }) };
  });
  return { plates };
}
export function validateMappedInput(input) {
  if (!object(input) || !object(input.projectData) || !/^[a-f0-9]{64}$/i.test(input.projectData.sha256 ?? '') || typeof input.projectData.filename !== 'string')
    throw new Error('Project data must be bound to the selected file');
  const manifest = validateProjectData(input.projectData);
  if (!Array.isArray(input.plates) || input.plates.length !== 1)
    throw new Error('Choose exactly one plate');
  const plate = manifest.plates.find((p) => p.number === input.plates[0]);
  if (!plate) throw new Error('Selected plate is absent from project data');
  if (!Array.isArray(input.mappings) || input.mappings.length !== plate.filaments.length)
    throw new Error('Choose one Hive requirement for every source filament on this plate');
  const mappings = new Map(), targetSlots = new Map();
  for (const mapping of input.mappings) {
    if (!object(mapping) || !Number.isInteger(mapping.sourceSlot) || !materialIdPattern.test(mapping.materialId ?? '') || mappings.has(mapping.sourceSlot) || !plate.filaments.some((f) => f.sourceSlot === mapping.sourceSlot))
      throw new Error('Mappings must name each source slot once and a valid Hive filament ID');
    mappings.set(mapping.sourceSlot, mapping.materialId);
    const target = validateTargetSlot(mapping.targetSlot);
    if (target) {
      if (typeof input.printer_id !== 'string' || !input.printer_id.trim()) throw new Error('Choose a named printer before adding a placement hint');
      targetSlots.set(mapping.sourceSlot, target);
    }
  }
  return { projectData: { filename: input.projectData.filename, sha256: input.projectData.sha256.toLowerCase(), ...manifest }, plate, mappings, targetSlots };
}
export function resolveMappedInput(input) {
  const { projectData, plate, mappings, targetSlots } = validateMappedInput(input);
  const catalogSelections = plate.filaments.map(({ sourceSlot }) => ({ sourceSlot, id: mappings.get(sourceSlot) }));
  return {
    ...input,
    projectData,
    catalogSelections,
    filaments: catalogSelections.map(({ sourceSlot, id }) => ({ sourceSlot, filamentId: id, ...(targetSlots.has(sourceSlot) ? { targetSlot: targetSlots.get(sourceSlot) } : {}) })),
  };
}
