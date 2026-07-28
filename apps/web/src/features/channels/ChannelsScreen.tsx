import { DASHBOARD_SUBTITLE } from "@/brand";
import { ErrorNote } from "@/components/error-note";
import { CreateChannel } from "./CreateChannel";
import { ChannelCard } from "./ChannelCard";
import { useChannels } from "./hooks";

export function ChannelsScreen() {
  const channels = useChannels();
  const list = channels.data ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="text-sm text-muted-foreground">{DASHBOARD_SUBTITLE}</p>
      </div>

      {channels.error && <ErrorNote>{(channels.error as Error).message}</ErrorNote>}

      <CreateChannel />

      {channels.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No channels yet. Create your first one above.</p>
      ) : (
        <div className="grid gap-4">
          {list.map((c) => (
            <ChannelCard key={c.id} channel={c} />
          ))}
        </div>
      )}
    </div>
  );
}
