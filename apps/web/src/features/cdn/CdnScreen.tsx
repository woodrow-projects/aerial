import { CdnSettings } from "./CdnSettings";

export function CdnScreen() {
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Delivery</h1>
        <p className="text-sm text-muted-foreground">
          Front HLS with a CDN so scale is a budget line, not a re-platform.
        </p>
      </div>
      <CdnSettings />
    </div>
  );
}
