import { z } from "zod";

export const sourceSchema = z.object({
  sourceSlot: z.number().int(),
  name: z.string().optional(),
  material: z.string(),
  color: z.string(),
});
export const plateSchema = z.object({
  number: z.number().int(),
  filaments: z.array(sourceSchema),
});
export const projectSchema = z.object({
  filename: z.string(),
  sha256: z.string(),
  plates: z.array(plateSchema),
});
export const extractionSchema = z.object({
  filename: z.string(),
  sha256: z.string(),
  plates: z.array(
    z.object({
      number: z.number().int(),
      usage: z
        .object({
          kind: z.string(),
          sourceSlots: z.array(z.number()).optional(),
          reason: z.string().optional(),
        })
        .passthrough()
        .optional(),
    }),
  ),
  palette: z.array(
    sourceSchema.extend({
      color: z.string().nullable(),
      selectable: z.boolean(),
      unavailableReason: z.string().nullable().optional(),
    }),
  ),
  warnings: z.array(z.string()),
});
export const materialSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  sku: z.string().nullable(),
  materialType: z.string(),
  color: z.string().nullable(),
  selectable: z.boolean(),
  unavailableReason: z.string().nullable(),
});
export const catalogSchema = z.object({
  materials: z.array(materialSchema),
  total: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});
export const configSchema = z.object({
  baseUrl: z.string(),
  production: z.boolean(),
  maxUploadBytes: z.number(),
  sdk: z.object({
    version: z.string(),
    source: z.string(),
    capabilities: z.object({
      filamentCatalog: z.boolean(),
      printJobRead: z.boolean(),
    }),
  }),
});
const jobSchema = z
  .object({
    id: z.number(),
    status: z.string(),
    printer_id: z.string().nullable().optional(),
    filament_route_state: z.string().nullable().optional(),
    filament_waiting_reasons: z.array(z.unknown()).default([]),
  })
  .passthrough();
export const jobReadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("available"), job: jobSchema }),
  z.object({ kind: z.literal("missing") }),
  z.object({ kind: z.literal("not_created") }),
  z.object({
    kind: z.literal("unavailable"),
    code: z.string(),
    upstreamStatus: z.number().nullable().optional(),
  }),
]);
export const receiptSchema = z
  .object({
    status: z.string(),
    requestId: z.string().nullable().optional(),
    job: z.object({ id: z.number() }).passthrough().nullable().optional(),
    requiredActions: z.array(z.unknown()).default([]),
    error: z.unknown().optional(),
    jobRead: jobReadSchema.optional(),
  })
  .passthrough();
export const orderSchema = z.object({
  id: z.string(),
  plates: z.array(receiptSchema),
});
export const acceptedSchema = z.object({
  id: z.string(),
  requests: z.array(
    z.object({ plate: z.number(), requestId: z.string().nullable() }),
  ),
});
export const previewSchema = z.object({
  plate: z.number(),
  filaments: z.array(
    z.object({
      sourceSlot: z.number(),
      material: z.string(),
      color: z.string(),
      targetSlot: z
        .object({ ams_id: z.number(), slot_id: z.number() })
        .optional(),
    }),
  ),
});
const errorSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export type Plate = z.infer<typeof plateSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export type Material = z.infer<typeof materialSchema>;
export type Config = z.infer<typeof configSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Hint = { ams: string; slot: string };
export type MappedInput = {
  id: string;
  plates: number[];
  projectData: Project;
  mappings: {
    sourceSlot: number;
    materialId: string;
    targetSlot?: { ams_id: number; slot_id: number };
  }[];
  release: string;
  on_filament_mismatch: string;
  printer_id?: string;
};
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed";
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, options);
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(data);
    throw new Error(
      `${error.success ? (error.data.error ?? "Request failed") : "Request failed"}${error.success && error.data.code ? ` (${error.data.code})` : ""} · HTTP ${response.status}`,
    );
  }
  return schema.parse(data);
}
export function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
