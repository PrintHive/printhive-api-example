import { useEffect, useRef, useState } from "react";
import { api, message, printersSchema } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { SdkCall } from "./sdk-call";
import { z } from "zod";

type Page = z.infer<typeof printersSchema>;
export function PrinterSearch({
  disabled,
  choose,
}: {
  disabled: boolean;
  choose: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function find(offset = 0) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setPage(null);
    setStatus("Searching printers…");
    try {
      const result = await api(
        `/printers?${new URLSearchParams({ q: query.trim(), offset: String(offset) })}`,
        printersSchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setPage(result);
      setStatus(
        result.printers.length
          ? `${result.total} matching printers`
          : "No matching printers. Try a name or model.",
      );
    } catch (error) {
      if (!controller.signal.aborted) setStatus(message(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <SdkCall call={"client.printers.search({ query, limit: 20, offset })"}>
        Hive searches your organization's printers. Selecting a result pins its
        ID; it does not establish readiness.
      </SdkCall>
      <Label htmlFor="printer-search">Find a printer by name or model</Label>
      <div className="flex gap-2">
        <Input
          id="printer-search"
          type="search"
          placeholder="Boo P1S"
          maxLength={100}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            pending.current?.abort();
            setBusy(false);
            setPage(null);
            setStatus("Press Find printers to search.");
            setQuery(e.target.value);
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
          disabled={disabled || busy}
          onClick={() => void find()}
        >
          Find printers
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
      {page?.printers.map((printer) => (
        <div
          key={printer.id}
          className="rounded-md border p-3 space-y-2 text-xs"
        >
          <p className="font-medium">
            {printer.name} · {printer.model} {printer.status}
          </p>
          <p className="font-mono break-all">{printer.id}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => choose(printer.id)}
          >
            Use {printer.name}
          </Button>
        </div>
      ))}
      {page && (page.offset > 0 || page.hasMore) && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy || page.offset === 0}
            onClick={() => void find(Math.max(0, page.offset - 20))}
          >
            Previous printers
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy || !page.hasMore}
            onClick={() => void find(page.offset + 20)}
          >
            More printers
          </Button>
        </div>
      )}
    </div>
  );
}
