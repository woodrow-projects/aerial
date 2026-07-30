import type { ChannelDto, DeliveryMode } from "@aerial/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Endpoint } from "@/components/endpoint";
import { ErrorNote } from "@/components/error-note";
import { AutoDjControls } from "./AutoDjControls";
import {
  useCreateKey,
  useDeleteChannel,
  useRevokeKey,
  useSetActive,
  useSetDeliveryMode,
  useStreamKeys,
} from "./hooks";

export function ChannelCard({ channel }: { channel: ChannelDto }) {
  const keys = useStreamKeys(channel.id);
  const createKey = useCreateKey(channel.id);
  const revokeKey = useRevokeKey(channel.id);
  const setActive = useSetActive();
  const setDeliveryMode = useSetDeliveryMode();
  const deleteChannel = useDeleteChannel();

  const error =
    (createKey.error ??
      revokeKey.error ??
      setActive.error ??
      setDeliveryMode.error ??
      deleteChannel.error) as Error | null;

  const newKey = createKey.data;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{channel.name}</h3>
            <code className="text-sm text-muted-foreground">/{channel.slug}</code>
          </div>
          <div className="flex gap-2">
            <Badge variant={channel.live ? "live" : "default"}>
              {channel.live ? "● LIVE" : "○ fallback"}
            </Badge>
            <Badge variant={channel.isActive ? "on" : "off"}>
              {channel.isActive ? "active" : "stopped"}
            </Badge>
          </div>
        </div>

        <div className="my-4 grid gap-1.5">
          {channel.endpoints.hls && <Endpoint label="HLS" value={channel.endpoints.hls} />}
          {channel.endpoints.icecast && (
            <Endpoint label="Icecast" value={channel.endpoints.icecast} />
          )}
          <Endpoint label="Now playing" value={channel.endpoints.nowPlaying} />
          <Endpoint
            label="Streamer ingest"
            value={`${channel.endpoints.ingest.host}:${channel.endpoints.ingest.port}${channel.endpoints.ingest.mount}  (user: source${channel.endpoints.ingest.tls ? ", TLS" : ""})`}
          />
        </div>

        <Separator />

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Stream keys</strong>
            <Button
              variant="outline"
              size="sm"
              disabled={createKey.isPending}
              onClick={() => createKey.mutate()}
            >
              + New key
            </Button>
          </div>

          {newKey && (
            <div className="mt-2.5 grid gap-1.5 rounded-md border border-live bg-live/10 p-2.5 text-[13px]">
              Copy this now — it is shown only once:
              <code className="overflow-x-auto rounded bg-input-surface px-2 py-1 font-mono text-xs">
                {newKey.key}
              </code>
            </div>
          )}

          <ul className="mt-2.5 grid gap-1">
            {(keys.data ?? []).map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-1 text-sm">
                <code className="text-muted-foreground">{k.id.slice(0, 8)}…</code>
                <span className="text-muted-foreground">{k.isActive ? "active" : "revoked"}</span>
                {k.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive"
                    disabled={revokeKey.isPending}
                    onClick={() => revokeKey.mutate(k.id)}
                  >
                    revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <Separator className="my-4" />

        <div className="flex flex-wrap items-center gap-3">
          <label
            className="mr-auto flex items-center gap-2 text-[13px] text-muted-foreground"
            title="Changing this restarts the stream"
          >
            Delivery
            <Select
              value={channel.deliveryMode}
              onValueChange={(v) =>
                setDeliveryMode.mutate({ id: channel.id, deliveryMode: v as DeliveryMode })
              }
            >
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">HLS + Icecast</SelectItem>
                <SelectItem value="hls">HLS only</SelectItem>
                <SelectItem value="icecast">Icecast only</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <Button
            variant="outline"
            disabled={setActive.isPending}
            onClick={() => setActive.mutate({ id: channel.id, isActive: !channel.isActive })}
          >
            {channel.isActive ? "Stop" : "Start"}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete channel “{channel.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This stops the stream and removes its endpoints and stream keys. This cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="border border-destructive bg-transparent text-destructive hover:bg-destructive/10"
                  onClick={() => deleteChannel.mutate(channel.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator className="my-4" />

        <AutoDjControls channel={channel} />

        {error && <ErrorNote className="mt-3">{error.message}</ErrorNote>}
      </CardContent>
    </Card>
  );
}
