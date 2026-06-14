import { useEffect, useState } from "react";
import type { ChannelDto, StreamKeyCreatedDto, StreamKeyDto } from "@aerial/shared";
import { api } from "./api";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function App() {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () =>
    api
      .listChannels()
      .then(setChannels)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000); // poll for live state
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>
          Aerial <span className="tag">control plane</span>
        </h1>
        <p className="muted">Self-hosted radio. Self-host the brain, rent the edge.</p>
      </header>

      {error && <div className="error">{error}</div>}

      <CreateChannel
        onCreated={() => {
          setError(null);
          void refresh();
        }}
        onError={setError}
      />

      {loading ? (
        <p className="muted">Loading…</p>
      ) : channels.length === 0 ? (
        <p className="muted">No channels yet. Create your first one above.</p>
      ) : (
        <div className="channels">
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} onChange={refresh} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateChannel({ onCreated, onError }: { onCreated: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const slugValue = slug || slugify(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createChannel({ name, slug: slugValue });
      setName("");
      setSlug("");
      onCreated();
    } catch (err) {
      onError(String((err as Error).message ?? err));
    }
  };

  return (
    <form className="card create" onSubmit={submit}>
      <h2>New channel</h2>
      <div className="row">
        <input placeholder="Name (e.g. Main, Talk)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="slug" value={slugValue} onChange={(e) => setSlug(slugify(e.target.value))} />
        <button type="submit" disabled={!slugValue}>
          Create
        </button>
      </div>
    </form>
  );
}

function ChannelCard({
  channel,
  onChange,
  onError,
}: {
  channel: ChannelDto;
  onChange: () => void;
  onError: (e: string) => void;
}) {
  const [keys, setKeys] = useState<StreamKeyDto[]>([]);
  const [newKey, setNewKey] = useState<StreamKeyCreatedDto | null>(null);

  const loadKeys = () => api.listKeys(channel.id).then(setKeys).catch(() => undefined);
  useEffect(() => {
    void loadKeys();
  }, [channel.id]);

  const wrap = (p: Promise<unknown>) =>
    p.then(() => {
      void loadKeys();
      onChange();
    }).catch((e) => onError(String((e as Error).message ?? e)));

  return (
    <div className="card channel">
      <div className="channel-head">
        <div>
          <h3>{channel.name}</h3>
          <code className="muted">/{channel.slug}</code>
        </div>
        <div className="badges">
          <span className={channel.live ? "badge live" : "badge"}>{channel.live ? "● LIVE" : "○ fallback"}</span>
          <span className={channel.isActive ? "badge on" : "badge off"}>{channel.isActive ? "active" : "stopped"}</span>
        </div>
      </div>

      <div className="endpoints">
        <Endpoint label="HLS" value={channel.endpoints.hls} />
        <Endpoint label="Icecast" value={channel.endpoints.icecast} />
        <Endpoint label="Now playing" value={channel.endpoints.nowPlaying} />
        <Endpoint
          label="DJ ingest"
          value={`${channel.endpoints.ingest.host}:${channel.endpoints.ingest.port}${channel.endpoints.ingest.mount}  (user: source)`}
        />
      </div>

      <div className="keys">
        <div className="keys-head">
          <strong>Stream keys</strong>
          <button onClick={() => wrap(api.createKey(channel.id).then(setNewKey))}>+ New key</button>
        </div>
        {newKey && (
          <div className="newkey">
            Copy this now — it is shown only once:
            <code>{newKey.key}</code>
          </div>
        )}
        <ul>
          {keys.map((k) => (
            <li key={k.id}>
              <code className="muted">{k.id.slice(0, 8)}…</code>
              <span>{k.isActive ? "active" : "revoked"}</span>
              {k.isActive && <button onClick={() => wrap(api.revokeKey(channel.id, k.id))}>revoke</button>}
            </li>
          ))}
        </ul>
      </div>

      <div className="actions">
        <button onClick={() => wrap(api.setActive(channel.id, !channel.isActive))}>
          {channel.isActive ? "Stop" : "Start"}
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Delete channel "${channel.name}"?`)) void wrap(api.deleteChannel(channel.id));
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Endpoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="endpoint">
      <span className="endpoint-label">{label}</span>
      <code onClick={() => navigator.clipboard?.writeText(value)} title="click to copy">
        {value}
      </code>
    </div>
  );
}
