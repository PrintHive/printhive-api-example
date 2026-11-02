import { normalizeColor } from "../../src/project-data.mjs";
export function Color({ value, label }: { value: unknown; label?: string }) {
  const color = normalizeColor(value);
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className="size-4 shrink-0 rounded-xs border border-foreground/20"
        style={{ backgroundColor: color ?? "transparent" }}
      />
      <span className="font-mono">
        {label ? `${label} ` : ""}
        {color ?? "Unknown color"}
      </span>
    </span>
  );
}
export function ReportedColors({ value }: { value: unknown }) {
  const found: string[] = [];
  function visit(node: unknown) {
    if (typeof node === "string" && normalizeColor(node)) found.push(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object")
      Object.values(node).forEach(visit);
  }
  visit(value);
  return (
    <div className="flex flex-wrap gap-3">
      {found.map((color, index) => (
        <Color key={`${index}-${color}`} value={color} />
      ))}
    </div>
  );
}
