import { useEffect, useRef, useState } from "react";
import type { CdnStatus } from "@aerial/shared";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Endpoint } from "@/components/endpoint";
import { ErrorNote } from "@/components/error-note";
import {
  cdnBecameProvisioned,
  useCdn,
  useDisableCdn,
  useEnableCdn,
  useInvalidateChannels,
  useSetCdnKey,
} from "./hooks";

function badgeVariant(status: CdnStatus): "on" | "off" | "live" | "default" {
  if (status === "active") return "on";
  if (status === "error") return "off";
  if (status === "provisioning") return "live";
  return "default";
}

export function CdnSettings() {
  const cdnQuery = useCdn();
  const setCdnKey = useSetCdnKey();
  const enableCdn = useEnableCdn();
  const disableCdn = useDisableCdn();
  const invalidateChannels = useInvalidateChannels();

  const [keyInput, setKeyInput] = useState("");
  const cdn = cdnQuery.data;

  // When provisioning settles, the channel endpoints just flipped to the CDN —
  // refetch them (the old `if (next.status !== "provisioning") onChange()`).
  const prevStatus = useRef<CdnStatus | undefined>(undefined);
  useEffect(() => {
    const status = cdn?.status;
    if (status && cdnBecameProvisioned(prevStatus.current, status)) invalidateChannels();
    prevStatus.current = status;
  }, [cdn?.status, invalidateChannels]);

  if (!cdn) return null;

  const status = cdn.status;
  const busy = setCdnKey.isPending || enableCdn.isPending || disableCdn.isPending;
  const error = (setCdnKey.error ?? enableCdn.error ?? disableCdn.error) as Error | null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">CDN delivery</h2>
            <code className="text-sm text-muted-foreground">Bunny.net · one toggle</code>
          </div>
          <Badge variant={badgeVariant(status)}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Front HLS with a CDN so a viral spike becomes a budget line, not a re-platform. The Icecast
          mount and streamer ingest always stay origin-direct. The CDN is the spike/global layer — at
          steady low traffic a flat-egress origin can be cheaper.
        </p>

        {cdn.cdnHostname && status === "active" && (
          <Endpoint label="CDN host" value={`https://${cdn.cdnHostname}`} />
        )}

        {status === "error" && cdn.errorMessage && <ErrorNote>{cdn.errorMessage}</ErrorNote>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="password"
            placeholder={
              cdn.hasApiKey
                ? "Bunny API key (stored — paste to replace)"
                : "Paste your Bunny.net API key"
            }
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <Button
            disabled={busy || !keyInput}
            onClick={() => setCdnKey.mutate(keyInput, { onSuccess: () => setKeyInput("") })}
          >
            Save key
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {status === "active" || status === "provisioning" ? (
            <Button
              variant="outline"
              disabled={busy || status === "provisioning"}
              onClick={() => disableCdn.mutate()}
            >
              Disable CDN
            </Button>
          ) : (
            <Button
              disabled={busy || !cdn.hasApiKey}
              title={cdn.hasApiKey ? "" : "Save an API key first"}
              onClick={() => enableCdn.mutate()}
            >
              Enable CDN
            </Button>
          )}
        </div>

        {error && <ErrorNote>{error.message}</ErrorNote>}
      </CardContent>
    </Card>
  );
}
