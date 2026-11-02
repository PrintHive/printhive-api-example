import { useRef, useState } from "react";
import { z } from "zod";
import { Database, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, json, message, type Config } from "@/lib/api";
import { Color } from "./color";

const recordSchema = z.object({
  externalId: z.string(),
  brand: z.string().nullable().optional(),
  material: z.string(),
  colorName: z.string(),
  colorHex: z.string(),
  sku: z.string(),
  replacementFilamentId: z.string().nullable().optional(),
});
const bindingSchema = recordSchema.extend({
  id: z.string(),
  name: z.string().optional(),
});
const previewSchema = z.object({ records: z.array(recordSchema) });
const outcomesSchema = z.object({
  outcomes: z.array(
    z.discriminatedUnion("status", [
      z.object({
        status: z.literal("synced"),
        externalId: z.string(),
        filament: bindingSchema,
      }),
      z.object({
        status: z.literal("failed"),
        externalId: z.string(),
        error: z.string(),
      }),
    ]),
  ),
  synced: z.number(),
  failed: z.number(),
});
const listSchema = z.object({
  materials: z.array(bindingSchema),
  total: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});
type RecordInput = z.infer<typeof recordSchema>;
type Outcome = z.infer<typeof outcomesSchema>["outcomes"][number];
function Fields({ record }: { record: RecordInput & { id?: string } }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-sm">{record.externalId}</p>
      <div className="text-xs flex flex-wrap gap-3">
        <span>
          {record.brand} {record.material} · {record.colorName}
        </span>
        <Color value={record.colorHex} />
        <span>SKU {record.sku}</span>
      </div>
      {record.replacementFilamentId != null && (
        <p className="text-xs text-muted-foreground">
          Informational replacement ID: {record.replacementFilamentId}
        </p>
      )}
      {record.id && (
        <div className="space-y-2">
          <Label>Hive filament UUID</Label>
          <Input
            aria-label={`Hive UUID for ${record.externalId}`}
            readOnly
            value={record.id}
            className="font-mono text-xs"
            onClick={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
export function CatalogSync({ config }: { config: Config | null }) {
  const available = config?.sdk.capabilities.filamentCatalog === true;
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<RecordInput[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(
    "Validate and preview records before syncing.",
  );
  const [outcomes, setOutcomes] = useState<Map<string, Outcome>>(new Map());
  const [externalId, setExternalId] = useState(""),
    [sku, setSku] = useState(""),
    [getId, setGetId] = useState("");
  const [bindings, setBindings] = useState<z.infer<typeof bindingSchema>[]>([]),
    [page, setPage] = useState({ total: 0, offset: 0, hasMore: false }),
    [readStatus, setReadStatus] = useState("");
  const version = useRef(0);
  function invalidate(text: string) {
    version.current++;
    setInput(text);
    setPreview(null);
    setOutcomes(new Map());
    setError("");
    setStatus("Validate and preview the current records before syncing.");
  }
  async function validate() {
    if (busy) return;
    const own = ++version.current;
    setBusy(true);
    setError("");
    setPreview(null);
    setOutcomes(new Map());
    try {
      const data = await api(
        "/catalog-sync/preview",
        previewSchema,
        json(JSON.parse(input)),
      );
      if (own !== version.current) return;
      setPreview(data.records);
      setStatus(
        `Validated ${data.records.length} records. Preview only; no catalog writes were made.`,
      );
    } catch (e) {
      if (own === version.current) {
        setError(
          e instanceof SyntaxError
            ? "Paste a valid JSON records array."
            : message(e),
        );
        setStatus("Nothing was synced.");
      }
    } finally {
      setBusy(false);
    }
  }
  async function sync(records: RecordInput[]) {
    if (busy || !available || !preview) return;
    const own = version.current;
    setBusy(true);
    setError("");
    setStatus(`Syncing ${records.length} records sequentially…`);
    try {
      const result = await api(
        "/catalog-sync/upsert",
        outcomesSchema,
        json({ records }),
      );
      if (own !== version.current) return;
      setOutcomes((previous) => {
        const next = new Map(previous);
        result.outcomes.forEach((outcome) =>
          next.set(outcome.externalId, outcome),
        );
        return next;
      });
      setStatus(
        `${result.synced} synced, ${result.failed} not confirmed. Read current bindings before retrying uncertain results.`,
      );
    } catch (e) {
      setError(
        `${message(e)}. Read current bindings before retrying; external IDs retain catalog identity.`,
      );
      setStatus("Sync result is not confirmed.");
    } finally {
      setBusy(false);
    }
  }
  async function list(offset = 0) {
    if (busy || !available) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        limit: "20",
        offset: String(offset),
      });
      if (externalId.trim()) query.set("externalId", externalId.trim());
      if (sku.trim()) query.set("sku", sku.trim());
      const data = await api(`/catalog-sync/list?${query}`, listSchema);
      setBindings(data.materials);
      setPage(data);
      setReadStatus(
        data.materials.length
          ? `${data.total} synced records · showing ${data.offset + 1}–${data.offset + data.materials.length}`
          : "No synced catalog bindings match these filters.",
      );
    } catch (e) {
      setBindings([]);
      setReadStatus(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function get() {
    if (busy || !available) return;
    if (!z.string().uuid().safeParse(getId.trim()).success) {
      setReadStatus("Enter a Hive filament UUID.");
      return;
    }
    setBusy(true);
    try {
      const data = await api(
        `/catalog-sync/filaments/${encodeURIComponent(getId.trim())}`,
        bindingSchema,
      );
      setBindings([data]);
      setReadStatus("Read current Hive binding.");
    } catch (e) {
      setBindings([]);
      setReadStatus(message(e));
    } finally {
      setBusy(false);
    }
  }
  const failed =
    preview?.filter(
      (record) => outcomes.get(record.externalId)?.status === "failed",
    ) ?? [];
  return (
    <details id="catalog-sync" className="rounded-md border bg-card">
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-5 font-semibold">
        <span className="flex items-center gap-3">
          <Database className="size-4" />
          Sync Printie filament catalog
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </summary>
      <div className="space-y-5 border-t p-5">
        <p className="text-sm text-muted-foreground">
          Update your organization’s Hive catalog. Syncing does not create an
          order or select a build-plate filament.
        </p>
        <p
          id="sync-capability"
          className="text-xs text-muted-foreground"
          role="status"
        >
          {!config
            ? "Checking SDK catalog support…"
            : available
              ? "SDK catalog sync is available. Preview first; Sync writes to the displayed API destination."
              : "Catalog sync is unavailable in this SDK. Order creation and requirement search remain available."}
        </p>
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sync-file">
              Import Printie catalog records as JSON
            </Label>
            <Input
              id="sync-file"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const own = ++version.current;
                setPreview(null);
                setOutcomes(new Map());
                try {
                  if (file.size > 65536)
                    throw new Error("Catalog JSON must be at most 64 KiB");
                  const text = await file.text();
                  if (own === version.current) {
                    setInput(text);
                    setStatus(
                      "Imported locally. Validate and preview before syncing.",
                    );
                    setError("");
                  }
                } catch (e) {
                  setError(message(e));
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sync-input">Catalog records</Label>
            <Textarea
              id="sync-input"
              rows={7}
              maxLength={65536}
              spellCheck={false}
              value={input}
              className="font-mono text-xs"
              placeholder={
                '[{"externalId":"printie-filament-123","brand":"Example","material":"PETG","colorName":"Green","colorHex":"#39FF14","sku":"PETG-GREEN"}]'
              }
              onChange={(e) => invalidate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Import 1–20 records. replacementFilamentId is informational and
              does not authorize substitution. Import and preview never sync
              records.
            </p>
          </div>
          <Button
            id="sync-preview"
            type="button"
            variant="outline"
            onClick={() => void validate()}
          >
            Validate and preview
          </Button>
        </fieldset>
        <div
          id="sync-preview-records"
          aria-label="Catalog sync preview"
          className="grid gap-3 sm:grid-cols-2"
        >
          {preview?.map((record) => (
            <div
              key={record.externalId}
              className="rounded-md border p-4 space-y-3"
            >
              <Fields record={record} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !available}
                onClick={() => void sync([record])}
              >
                Sync this record
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id="sync-all"
            type="button"
            variant="secondary"
            disabled={busy || !available || !preview}
            onClick={() => preview && void sync(preview)}
          >
            Sync {preview?.length ?? "previewed"} records
            {config?.production ? " to production" : ""}
          </Button>
          <Button
            id="sync-retry"
            type="button"
            variant="outline"
            disabled={busy || !available || !failed.length}
            onClick={() => void sync(failed)}
          >
            Retry failed records
          </Button>
        </div>
        <p
          id="sync-status"
          className="text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
        {error && (
          <p id="sync-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div
          id="sync-outcomes"
          aria-label="Catalog sync outcomes"
          className="grid gap-3 sm:grid-cols-2"
        >
          {[...outcomes.values()].map((outcome) => (
            <div key={outcome.externalId} className="rounded-md border p-4">
              {outcome.status === "synced" ? (
                <>
                  <p className="text-xs font-semibold mb-3">Synced</p>
                  <Fields record={outcome.filament} />
                </>
              ) : (
                <>
                  <p className="font-semibold text-sm">
                    Not confirmed: {outcome.externalId}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {outcome.error}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="border-t pt-5 space-y-4">
          <h3 className="font-semibold">Read synced Hive bindings</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sync-filter-external">Printie external ID</Label>
              <Input
                id="sync-filter-external"
                maxLength={200}
                value={externalId}
                disabled={busy}
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sync-filter-sku">SKU</Label>
              <Input
                id="sync-filter-sku"
                maxLength={200}
                value={sku}
                disabled={busy}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              id="sync-refresh"
              type="button"
              variant="outline"
              disabled={busy || !available}
              onClick={() => void list()}
            >
              Refresh synced catalog
            </Button>
            <Button
              id="sync-previous"
              type="button"
              variant="outline"
              disabled={busy || !available || page.offset === 0}
              onClick={() => void list(Math.max(0, page.offset - 20))}
            >
              Previous
            </Button>
            <Button
              id="sync-next"
              type="button"
              variant="outline"
              disabled={busy || !available || !page.hasMore}
              onClick={() => void list(page.offset + 20)}
            >
              More synced records
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sync-get-id">
              Read a synced Hive filament UUID
            </Label>
            <div className="flex gap-2">
              <Input
                id="sync-get-id"
                placeholder="Hive filament UUID"
                value={getId}
                disabled={busy}
                onChange={(e) => setGetId(e.target.value)}
              />
              <Button
                id="sync-get"
                type="button"
                variant="outline"
                disabled={busy || !available}
                onClick={() => void get()}
              >
                Read filament
              </Button>
            </div>
          </div>
          <p
            id="sync-read-status"
            className="text-xs text-muted-foreground"
            role="status"
          >
            {readStatus}
          </p>
          <div
            id="sync-read-results"
            aria-label="Synced catalog bindings"
            className="grid gap-3 sm:grid-cols-2"
          >
            {bindings.map((record) => (
              <div key={record.id} className="rounded-md border p-4">
                <Fields record={record} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Copy a synced SKU or UUID into a source filament’s requirement
            search. Job matching still uses material type and color, not exact
            SKU identity.
          </p>
        </div>
      </div>
    </details>
  );
}
