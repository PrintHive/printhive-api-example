import { SdkCall } from "./sdk-call";
import { useEffect, useRef, useState } from "react";
import { Check, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  api,
  catalogSchema,
  message,
  type Hint,
  type Material,
  type Source,
} from "@/lib/api";
import { Color } from "./color";

export function FilamentMapping({
  source,
  plateNumber,
  selected,
  hint,
  printer,
  disabled,
  choose,
  setHint,
}: {
  source: Source;
  plateNumber: number;
  selected?: Material;
  hint?: Hint;
  printer: string;
  disabled: boolean;
  choose: (value: Material) => void;
  setHint: (value: Hint) => void;
}) {
  const [query, setQuery] = useState(source.material);
  const [finderOpen, setFinderOpen] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [results, setResults] = useState<Material[]>([]);
  const [page, setPage] = useState({ total: 0, offset: 0, hasMore: false });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const version = useRef(0);
  async function find(offset = 0, text = query) {
    const ownVersion = ++version.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setStatus("Searching Hive’s catalog…");
    setResults([]);
    try {
      const data = await api(
        `/catalog?${new URLSearchParams({ q: text.trim(), offset: String(offset) })}`,
        catalogSchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || ownVersion !== version.current) return;
      setResults(data.materials);
      setPage(data);
      setStatus(
        (data.mode === "catalog-item-http"
          ? "HTTP GET /v1/materials/{id}. Direct catalog ID lookup. "
          : data.mode === "legacy-catalog"
            ? "SDK search unavailable: using legacy catalog HTTP lookup. "
            : data.matchMode === "broadened"
              ? "Hive broadened this query. "
              : "") +
          (data.materials.length
            ? `${data.total} results · showing ${data.offset + 1}–${data.offset + data.materials.length}`
            : "No matching catalog filaments. Try a name, SKU, or ID."),
      );
    } catch (e) {
      if (!controller.signal.aborted && ownVersion === version.current)
        setStatus(message(e));
    } finally {
      if (ownVersion === version.current) setLoading(false);
    }
  }
  useEffect(() => {
    void find(0, source.material);
    return () => {
      version.current++;
      request.current?.abort();
    };
  }, [source.material]);
  useEffect(() => {
    if (restoreFocus.current && selected && !finderOpen) {
      changeButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [selected, finderOpen]);
  const finderVisible = !selected || finderOpen;
  const finderId = `finder-${plateNumber}-${source.sourceSlot}`;
  const location = hint ?? { ams: "", slot: "" };
  return (
    <div
      className="mapping rounded-md border bg-background p-4 space-y-4"
      data-source-slot={source.sourceSlot}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {source.name ?? "Project filament"}{" "}
            <span className="text-muted-foreground font-normal">
              · source slot {source.sourceSlot}
            </span>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{source.material}</span>
            <Color value={source.color} />
          </div>
        </div>
        <Badge variant={selected ? "secondary" : "outline"}>
          {selected ? "Mapped" : "Choose requirement"}
        </Badge>
      </div>
      {selected && (
        <div className="rounded-md border border-foreground/15 bg-muted/50 p-3 text-sm space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <Check className="size-4 shrink-0" />
            Requirement: {selected.brand} {selected.name}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span>{selected.materialType}</span>
            <Color value={selected.color} />
            {selected.sku && (
              <span className="text-muted-foreground">SKU {selected.sku}</span>
            )}
          </div>
          <p className="font-mono text-xs break-all text-muted-foreground">
            ID {selected.id}
          </p>
          <Button
            ref={changeButton}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-expanded={finderVisible}
            aria-controls={finderId}
            onClick={() => setFinderOpen(true)}
          >
            Change requirement
          </Button>
        </div>
      )}
      {finderVisible && (
        <div id={finderId} className="space-y-4">
          <SdkCall call="client.filaments.search({ query, limit: 20, offset })">
            Hive searches catalog filaments by free text, such as black PETG or
            bambu red. Select a catalog filamentId; the server resolves it to
            the material and color accepted by create. SDK 0.3.2 uses the
            labeled legacy HTTP lookup until the search release is installed.
          </SdkCall>
          <div className="space-y-2">
            <Label htmlFor={`search-${plateNumber}-${source.sourceSlot}`}>
              Find a Hive filament by name, SKU, or ID
            </Label>
            <div className="flex gap-2">
              <Input
                id={`search-${plateNumber}-${source.sourceSlot}`}
                type="search"
                maxLength={100}
                placeholder="black PETG or bambu red"
                value={query}
                disabled={disabled}
                onChange={(e) => {
                  version.current++;
                  request.current?.abort();
                  setQuery(e.target.value);
                  setResults([]);
                  setLoading(false);
                  setStatus("Press Search to find catalog filaments.");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void find();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void find()}
                disabled={disabled || loading}
              >
                <Search className="size-4" />
                <span>Search</span>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            {status}
          </p>
          <div className="space-y-2 max-h-80 overflow-y-auto catalog-results">
            {results.map((item) => (
              <div
                key={item.id}
                className="rounded-md border p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between catalog-item"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-sm">
                    {item.brand} {item.name}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span>{item.materialType || "Unknown material"}</span>
                    <Color value={item.color} />
                    {item.sku && <span>SKU {item.sku}</span>}
                  </div>
                  <code className="block text-[11px] break-all text-muted-foreground">
                    {item.id}
                  </code>
                  {!item.selectable && (
                    <p className="text-xs text-muted-foreground">
                      {item.unavailableReason}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={selected?.id === item.id ? "secondary" : "outline"}
                  aria-pressed={selected?.id === item.id}
                  disabled={disabled || !item.selectable}
                  onClick={() => {
                    restoreFocus.current = true;
                    choose(item);
                    setFinderOpen(false);
                  }}
                >
                  {selected?.id === item.id && <Check className="size-3" />}Use{" "}
                  {item.name}
                </Button>
              </div>
            ))}
          </div>
          {page.total > 20 && results.length > 0 && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || loading || page.offset === 0}
                onClick={() => void find(Math.max(0, page.offset - 20))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || loading || !page.hasMore}
                onClick={() => void find(page.offset + 20)}
              >
                More results
              </Button>
            </div>
          )}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer flex items-center gap-2 text-muted-foreground">
          <ChevronDown className="size-3" />
          Optional placement on a named printer
        </summary>
        <p className="mt-3 text-xs text-muted-foreground">
          Source slots never determine physical placement. Leave both fields
          empty for Hive to resolve the route.
        </p>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {(
            [
              ["ams", "API AMS ID", 255],
              ["slot", "API slot ID", 3],
            ] as const
          ).map(([key, title, max]) => (
            <div key={key} className="space-y-2">
              <Label
                htmlFor={`target-${key}-${plateNumber}-${source.sourceSlot}`}
              >
                {title}
              </Label>
              <Input
                id={`target-${key}-${plateNumber}-${source.sourceSlot}`}
                aria-label={`${title} for source slot ${source.sourceSlot}`}
                data-target-input=""
                type="number"
                min={0}
                max={max}
                step={1}
                value={location[key]}
                disabled={disabled || !printer.trim()}
                onChange={(e) =>
                  setHint({ ...location, [key]: e.target.value })
                }
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
