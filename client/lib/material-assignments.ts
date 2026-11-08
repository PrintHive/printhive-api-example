import type { Source } from "./api";

// Source slots keep equal-color palette entries distinct. Names are display-only.
export function sourceKey(
  source: Pick<Source, "sourceSlot" | "material" | "color">,
): string {
  return JSON.stringify([
    source.sourceSlot,
    source.material.trim().toLowerCase(),
    source.color.trim().toLowerCase(),
  ]);
}

export function sharedSourcePlates(
  anchor: Source,
  plates: { number: number; sources: Source[] }[],
): number[] {
  const key = sourceKey(anchor);
  return plates
    .filter((plate) => plate.sources.some((s) => sourceKey(s) === key))
    .map((plate) => plate.number);
}

export function pruneSlots<T>(
  map: Record<number, Record<number, T>>,
  plate: number,
  keep: (slot: number) => boolean,
): Record<number, Record<number, T>> {
  return {
    ...map,
    [plate]: Object.fromEntries(
      Object.entries(map[plate] ?? {}).filter(([slot]) => keep(Number(slot))),
    ),
  };
}

export function selectedSourceGroups(plates: { number: number; sources: Source[] }[]) {
  const groups = new Map<string, { source: Source; plates: number[] }>();
  for (const plate of plates) for (const source of plate.sources) {
    const key = sourceKey(source);
    const group = groups.get(key) ?? { source, plates: [] };
    group.plates.push(plate.number);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.source.sourceSlot - b.source.sourceSlot);
}
