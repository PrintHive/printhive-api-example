import { validateMappedInput, resolveMappedInput } from './project-data.mjs';

export function mappedPlateInputs(input) {
  if (!Array.isArray(input?.plates) || !input.plates.length || new Set(input.plates).size !== input.plates.length || !input.plates.every(p => Number.isInteger(p) && p > 0) || !Array.isArray(input.plateMappings) || input.plateMappings.length !== input.plates.length || input.mappings !== undefined)
    throw new Error('Select unique plates and supply one mapping group per selected plate');
  const byPlate = new Map();
  for (const group of input.plateMappings) {
    if (!group || !input.plates.includes(group.plate) || byPlate.has(group.plate)) throw new Error('Mapping groups must name each selected plate once');
    byPlate.set(group.plate, group.mappings);
  }
  return [...input.plates].sort((a, b) => a - b).map(plate => {
    const value = { ...input, plates: [plate], mappings: byPlate.get(plate) };
    validateMappedInput(value);
    return value;
  });
}

export async function resolveMappedPlates(input, catalog, savedIntent) {
  const inputs = mappedPlateInputs(input);
  const bindings = inputs.map(value => {
    const { mappings, targetSlots } = validateMappedInput(value);
    return { plate: value.plates[0], mappings: [...mappings].sort(([a], [b]) => a - b).map(([sourceSlot, materialId]) => ({ sourceSlot, materialId: materialId.toLowerCase(), ...(targetSlots.has(sourceSlot) ? { targetSlot: targetSlots.get(sourceSlot) } : {}) })) };
  });
  if (savedIntent && JSON.stringify(savedIntent.plateMappings) !== JSON.stringify(bindings)) throw new Error('Order id conflicts with stored intent');
  const requirements = savedIntent ? savedIntent.plateRequirements : await Promise.all(inputs.map(async value => {
    const resolved = await resolveMappedInput(value, catalog);
    return { plate: value.plates[0], filaments: resolved.filaments, catalogSelections: resolved.catalogSelections };
  }));
  if (!requirements) throw new Error('Order id conflicts with stored intent');
  return { ...input, plates: inputs.map(value => value.plates[0]), projectData: validateMappedInput(inputs[0]).projectData, plateMappings: bindings, plateRequirements: requirements };
}
