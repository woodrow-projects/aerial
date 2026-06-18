import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BunnyProvider } from "./bunny.provider";

/**
 * Baseline tests for the Bunny.net pull-zone adapter (ADR D4). The HTTP boundary
 * (`fetch`) is stubbed — these assert the request shape sent to the Bunny API and
 * how the response is mapped to a ProvisionResult, with no real network.
 */
type FetchResult = { ok: boolean; status: number; statusText: string; body: string };

function stubFetch(result: Partial<FetchResult> = {}) {
  const res: FetchResult = { ok: true, status: 200, statusText: "OK", body: "", ...result };
  const fetchMock = vi.fn(async () => ({
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text: async () => res.body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The (url, init) of the nth fetch call, with the JSON body parsed. */
function callAt(fetchMock: ReturnType<typeof stubFetch>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

const KEY = "bunny-access-key";
const ORIGIN = "https://radio.example.com";

describe("BunnyProvider.provision", () => {
  let provider: BunnyProvider;
  beforeEach(() => {
    provider = new BunnyProvider();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs a pull zone to the Bunny API with the access key and origin", async () => {
    const fetchMock = stubFetch({ body: JSON.stringify({ Id: 42, Name: "aerial-deadbeef" }) });

    await provider.provision(KEY, ORIGIN);

    const { url, init, body } = callAt(fetchMock);
    expect(url).toBe("https://api.bunny.net/pullzone");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).AccessKey).toBe(KEY);
    expect(body.OriginUrl).toBe(ORIGIN);
    expect(body.Type).toBe(0); // standard HTTP origin pull
    expect(body.Name).toMatch(/^aerial-[0-9a-f]{8}$/); // random, collision-avoiding suffix
  });

  it("maps the response to a ProvisionResult, preferring the returned b-cdn.net hostname", async () => {
    const fetchMock = stubFetch({
      body: JSON.stringify({ Id: 7, Name: "aerial-abc", Hostnames: [{ Value: "aerial-abc.b-cdn.net" }] }),
    });

    const result = await provider.provision(KEY, ORIGIN);

    expect(result).toEqual({ pullZoneId: "7", cdnHostname: "aerial-abc.b-cdn.net" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to <Name>.b-cdn.net when the response carries no hostnames", async () => {
    stubFetch({ body: JSON.stringify({ Id: 9, Name: "aerial-xyz" }) });

    const result = await provider.provision(KEY, ORIGIN);

    expect(result).toEqual({ pullZoneId: "9", cdnHostname: "aerial-xyz.b-cdn.net" });
  });

  it("throws a descriptive error when Bunny rejects the request", async () => {
    stubFetch({ ok: false, status: 401, statusText: "Unauthorized", body: "bad key" });

    await expect(provider.provision(KEY, ORIGIN)).rejects.toThrow(/Bunny POST \/pullzone failed: 401 Unauthorized bad key/);
  });
});

describe("BunnyProvider.configure / teardown", () => {
  let provider: BunnyProvider;
  beforeEach(() => {
    provider = new BunnyProvider();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("configure POSTs cache rules that respect the origin's Cache-Control", async () => {
    const fetchMock = stubFetch();

    await provider.configure(KEY, "zone-1");

    const { url, init, body } = callAt(fetchMock);
    expect(url).toBe("https://api.bunny.net/pullzone/zone-1");
    expect(init.method).toBe("POST");
    expect(body).toMatchObject({
      CacheControlMaxAgeOverride: -1, // -1 = honour origin Cache-Control
      CacheControlBrowserMaxAgeOverride: -1,
      EnableCacheSlice: false, // wrong for small HLS segments
      DisableCookies: true,
    });
  });

  it("teardown DELETEs the pull zone", async () => {
    const fetchMock = stubFetch();

    await provider.teardown(KEY, "zone-9");

    const { url, init } = callAt(fetchMock);
    expect(url).toBe("https://api.bunny.net/pullzone/zone-9");
    expect(init.method).toBe("DELETE");
  });
});
