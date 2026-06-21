import { useEffect, useState } from "react";
import type { CdnConfigDto, ChannelDto, DeliveryMode, StreamKeyCreatedDto, StreamKeyDto } from "@aerial/shared";
import { api } from "./api";
import { signOut, useSession } from "./auth-client";
import { Login } from "./Login";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function App() {
  const { data: session, isPending } = useSession();
  if (isPending) {
    return (
      <div className="app">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!session) return <Login />;
  return <Dashboard />;
}

function Dashboard() {
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
        <div className="header-row">
          <h1>
            Aerial <span className="tag">control plane</span>
          </h1>
          <button
            className="signout"
            onClick={() => signOut({ fetchOptions: { onSuccess: () => location.assign("/") } })}
          >
            Sign out
          </button>
        </div>
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

      <CdnSettings onError={setError} onChange={refresh} />

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
      await api.createChannel({ name, slug: slugValue, deliveryMode: "both" });
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

function CdnSettings({ onError, onChange }: { onError: (e: string) => void; onChange: () => void }) {
  const [cdn, setCdn] = useState<CdnConfigDto | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.getCdn().then(setCdn).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  // While provisioning, poll so the operator watches provisioning → active live.
  useEffect(() => {
    if (cdn?.status !== "provisioning") return;
    const t = setInterval(() => {
      void api.getCdn().then((next) => {
        setCdn(next);
        if (next.status !== "provisioning") onChange(); // endpoints just flipped to the CDN
      });
    }, 3000);
    return () => clearInterval(t);
  }, [cdn?.status]);

  const run = (p: Promise<CdnConfigDto>) => {
    setBusy(true);
    p.then((next) => {
      setCdn(next);
      onChange();
    })
      .catch((e) => onError(String((e as Error).message ?? e)))
      .finally(() => setBusy(false));
  };

  if (!cdn) return null;

  const status = cdn.status;
  const badgeClass =
    status === "active" ? "badge on" : status === "error" ? "badge off" : status === "provisioning" ? "badge live" : "badge";

  return (
    <div className="card cdn">
      <div className="channel-head">
        <div>
          <h2>CDN delivery</h2>
          <code className="muted">Bunny.net · one toggle</code>
        </div>
        <span className={badgeClass}>{status}</span>
      </div>

      <p className="muted">
        Front HLS with a CDN so a viral spike becomes a budget line, not a re-platform. The Icecast mount and
        streamer ingest always stay origin-direct. The CDN is the spike/global layer — at steady low traffic a flat-egress
        origin can be cheaper.
      </p>

      {cdn.cdnHostname && status === "active" && (
        <div className="endpoints">
          <Endpoint label="CDN host" value={`https://${cdn.cdnHostname}`} />
        </div>
      )}

      {status === "error" && cdn.errorMessage && <div className="error">{cdn.errorMessage}</div>}

      <div className="row">
        <input
          type="password"
          placeholder={cdn.hasApiKey ? "Bunny API key (stored — paste to replace)" : "Paste your Bunny.net API key"}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
        />
        <button
          disabled={busy || !keyInput}
          onClick={() => run(api.setCdnKey(keyInput).then((next) => {
            setKeyInput("");
            return next;
          }))}
        >
          Save key
        </button>
      </div>

      <div className="actions">
        {status === "active" || status === "provisioning" ? (
          <button disabled={busy || status === "provisioning"} onClick={() => run(api.disableCdn())}>
            Disable CDN
          </button>
        ) : (
          <button disabled={busy || !cdn.hasApiKey} title={cdn.hasApiKey ? "" : "Save an API key first"} onClick={() => run(api.enableCdn())}>
            Enable CDN
          </button>
        )}
      </div>
    </div>
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
        {channel.endpoints.hls && <Endpoint label="HLS" value={channel.endpoints.hls} />}
        {channel.endpoints.icecast && <Endpoint label="Icecast" value={channel.endpoints.icecast} />}
        <Endpoint label="Now playing" value={channel.endpoints.nowPlaying} />
        <Endpoint
          label="Streamer ingest"
          value={`${channel.endpoints.ingest.host}:${channel.endpoints.ingest.port}${channel.endpoints.ingest.mount}  (user: source${channel.endpoints.ingest.tls ? ", TLS" : ""})`}
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
        <label className="delivery" title="Changing this restarts the stream">
          Delivery
          <select
            value={channel.deliveryMode}
            onChange={(e) => wrap(api.setDeliveryMode(channel.id, e.target.value as DeliveryMode))}
          >
            <option value="both">HLS + Icecast</option>
            <option value="hls">HLS only</option>
            <option value="icecast">Icecast only</option>
          </select>
        </label>
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
