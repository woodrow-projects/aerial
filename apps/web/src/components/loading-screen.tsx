export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}
