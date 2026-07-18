import type { Channel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ChannelsService } from "./channels.service";

const ORIGIN = "https://radio.example.com";

function makeChannel(): Channel {
  return {
    id: "c1",
    name: "Main",
    slug: "main",
    mount: "/main",
    isActive: true,
    deliveryMode: "both",
    harborPort: 8100,
    hlsBitrates: "[64,128]", // stored as JSON text (SQLite has no scalar lists)
    icecastBitrate: 128,
    createdAt: new Date("2026-06-18T00:00:00Z"),
    updatedAt: new Date("2026-06-18T00:00:00Z"),
  };
}

/** Build a ChannelsService with only the deps endpoints()/toDto touch. */
function makeService(hlsBaseUrl: string): ChannelsService {
  const cdn = { hlsBaseUrl: () => hlsBaseUrl };
  const nowPlaying = { isLive: () => false };
  return new ChannelsService(undefined as never, undefined as never, nowPlaying as never, cdn as never);
}

describe("ChannelsService toDto column decoding", () => {
  it("decodes the stored deliveryMode and hlsBitrates columns into the DTO shapes", () => {
    const svc = makeService(ORIGIN);
    const dto = (
      svc as unknown as { toDto: (c: Channel) => { deliveryMode: string; hlsBitrates: number[] } }
    ).toDto(makeChannel());
    expect(dto.deliveryMode).toBe("both");
    expect(dto.hlsBitrates).toEqual([64, 128]);
  });
});

describe("ChannelsService endpoint rewrite (CDN)", () => {
  it("serves HLS + nowplaying from the origin when the CDN is inactive", () => {
    const svc = makeService(ORIGIN);
    const { endpoints } = (svc as unknown as { toDto: (c: Channel) => { endpoints: Record<string, unknown> } }).toDto(
      makeChannel(),
    );
    expect(endpoints.hls).toBe(`${ORIGIN}/hls/main/live.m3u8`);
    expect(endpoints.nowPlaying).toBe(`${ORIGIN}/hls/main/nowplaying.json`);
    expect(endpoints.icecast).toBe(`${ORIGIN}/icecast/main`);
  });

  it("serves HLS + nowplaying from the CDN when active, but pins Icecast + ingest to the origin (D2)", () => {
    const CDN = "https://aerial-test.b-cdn.net";
    const svc = makeService(CDN);
    const { endpoints } = (
      svc as unknown as {
        toDto: (c: Channel) => { endpoints: { hls: string; nowPlaying: string; icecast: string; ingest: { host: string } } };
      }
    ).toDto(makeChannel());

    // HLS path follows the CDN…
    expect(endpoints.hls).toBe(`${CDN}/hls/main/live.m3u8`);
    expect(endpoints.nowPlaying).toBe(`${CDN}/hls/main/nowplaying.json`);
    // …but the persistent stream + ingest never do (origin host).
    expect(endpoints.icecast).toBe(`${ORIGIN}/icecast/main`);
    expect(endpoints.ingest.host).toBe("radio.example.com");
  });
});
