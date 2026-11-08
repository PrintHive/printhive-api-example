import { z } from "zod";
import type { Receipt } from "./api";

const detailSchema = z.object({
  code: z.string().optional(), error: z.string().optional(), message: z.string().optional(),
  reason: z.string().optional(), body: z.object({ error: z.string().optional(), message: z.string().optional() }).optional(),
});
function reasonOf(value: unknown) {
  const parsed = detailSchema.safeParse(value);
  if (!parsed.success) return typeof value === "string" ? value : JSON.stringify(value);
  const detail = parsed.data;
  return [detail.code ?? detail.error ?? detail.body?.error, detail.message ?? detail.reason ?? detail.body?.message].filter(Boolean).join(": ") || JSON.stringify(value);
}

// Adapted from Start Print's ledger: a creation receipt and live job remain separate.
export function progressOf(receipt: Receipt) {
  switch (receipt.status) {
    case "preparing": return { label: "Slicing / preparing", reason: "Hive is inspecting, slicing, or processing this plate." };
    case "held": return { label: "Held for review", reason: receipt.requiredActions.map(reasonOf).join("; ") || "held_without_reason" };
    case "failed": return { label: "Failed", reason: reasonOf(receipt.error) || "no_reason_given" };
    case "created": {
      const job = receipt.jobRead?.kind === "available" ? receipt.jobRead.job : null;
      return { label: job?.status.toUpperCase() === "QUEUED" ? "Queued · job created" : "Job created", reason: `Job ${receipt.job?.id ?? "ID unavailable"}${job ? ` · ${job.status}` : ""}` };
    }
    case "cancelled": return { label: "Cancelled", reason: "No job will be created from this request." };
    case "pending_submission": return { label: "Not sent", reason: receipt.error ? reasonOf(receipt.error) : "Retry the same order to resume with its saved key." };
    default: return { label: receipt.status, reason: receipt.error ? reasonOf(receipt.error) : "Status is unknown. Polling will retry." };
  }
}
export function rollUpProgress(receipts: Receipt[]) {
  if (!receipts.length) return "Waiting for receipts…";
  const count = (status: string) => receipts.filter(row => row.status === status).length;
  return `${count("created")} of ${receipts.length} jobs created · ${count("preparing")} preparing · ${count("held")} held · ${count("failed")} failed · ${count("cancelled")} cancelled`;
}
