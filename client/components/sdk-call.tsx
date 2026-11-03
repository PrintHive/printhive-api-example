export function SdkCall({
  call,
  children,
}: {
  call: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
      <code className="block break-words font-mono">{call}</code>
      <p className="text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
