import { AlertTriangle, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useOrderWorkflow } from "@/lib/use-order-workflow";
import { ProjectOrder } from "@/components/project-order";
import { OrderStatus } from "@/components/order-status";
import { CatalogSync } from "@/components/catalog-sync";

export default function App() {
  const flow = useOrderWorkflow();
  const sdk = flow.config?.sdk;
  const source =
    sdk?.source === "local-workspace"
      ? "local workspace build, not an npm release"
      : sdk?.source === "local-package"
        ? "local package build, not an npm release"
        : "installed package";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-foreground text-background">
        <div className="mx-auto max-w-7xl px-5 py-5 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/mark.svg" alt="" aria-hidden="true" className="size-8" />
            <span className="font-semibold tracking-tight text-lg">
              PrintHive{" "}
              <span className="font-normal text-background/40 mx-2">/</span>
              <span className="text-sm text-background/60">API example</span>
            </span>
          </div>
          <a
            href="https://printhiv3d.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-background/60 hover:text-background"
          >
            PrintHive
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10 space-y-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
              Project to production
            </p>
            <h1 className="font-heading text-3xl sm:text-4xl tracking-tight">
              Try a print order
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Choose a plate. Map its filaments. Follow it into your queue.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            {flow.config?.production
              ? "Production API"
              : flow.config
                ? "Custom API"
                : "Connecting"}
          </Badge>
        </div>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 rounded-md border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p id="target" role="status" className="text-xs break-all">
              <span className="text-muted-foreground">API destination: </span>
              {flow.config?.baseUrl ?? "Loading destination…"}
            </p>
            <p
              id="sdk-info"
              className="text-[11px] text-muted-foreground"
              role="status"
            >
              {sdk
                ? `@printhive/api ${sdk.version} · ${source}`
                : "Loading SDK information…"}
            </p>
          </div>
          {flow.config?.production && (
            <div
              id="warning"
              className="flex gap-3 rounded-md border border-amber-700/20 bg-amber-50 p-4 text-amber-950"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <p className="text-xs leading-relaxed">
                Auto release in production queues a real print. Review your
                destination and release mode before submitting. Manual release
                lets you review first.
              </p>
            </div>
          )}
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
          <ProjectOrder flow={flow} />
          <OrderStatus flow={flow} />
        </div>
        <CatalogSync config={flow.config} />
        <footer className="border-t pt-5 pb-3 flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
          <p>
            Your API key stays on this server. This page sends requests only to
            this server. Job creation does not bypass material, readiness or
            bed-clear checks.
          </p>
        </footer>
      </main>
    </div>
  );
}
