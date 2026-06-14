import type {
  ChannelDto,
  CreateChannelInput,
  StreamKeyCreatedDto,
  StreamKeyDto,
} from "@aerial/shared";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const POST_JSON = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  listChannels: () => fetch(`${BASE}/channels`).then(json<ChannelDto[]>),

  createChannel: (input: CreateChannelInput) =>
    fetch(`${BASE}/channels`, POST_JSON(input)).then(json<ChannelDto>),

  setActive: (id: string, isActive: boolean) =>
    fetch(`${BASE}/channels/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    }).then(json<ChannelDto>),

  deleteChannel: (id: string) => fetch(`${BASE}/channels/${id}`, { method: "DELETE" }),

  listKeys: (id: string) => fetch(`${BASE}/channels/${id}/keys`).then(json<StreamKeyDto[]>),

  createKey: (id: string) =>
    fetch(`${BASE}/channels/${id}/keys`, { method: "POST" }).then(json<StreamKeyCreatedDto>),

  revokeKey: (id: string, keyId: string) =>
    fetch(`${BASE}/channels/${id}/keys/${keyId}`, { method: "DELETE" }),
};
