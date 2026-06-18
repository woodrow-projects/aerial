import { describe, expect, it } from "vitest";
import { buildLiquidsoapScript, type LiquidsoapParams } from "./liq-template";

/**
 * Unit tests for the per-channel Liquidsoap config generator (ADR D2/D6/D8).
 * Pure function → pure assertions. The contract under test is "which output
 * blocks are emitted for a given deliveryMode" plus safe interpolation.
 */
function params(overrides: Partial<LiquidsoapParams> = {}): LiquidsoapParams {
  return {
    slug: "jazz",
    name: "Jazz FM",
    mount: "/jazz",
    harborPort: 8100,
    deliveryMode: "both",
    hlsBitrates: [64, 128],
    icecastBitrate: 128,
    hlsDir: "/srv/hls/jazz",
    mediaDir: "/srv/media/jazz",
    icecastHost: "icecast",
    icecastPort: 8000,
    icecastSourcePassword: "s3cret",
    internalApiUrl: "http://localhost:3000",
    internalToken: "tok",
    ...overrides,
  };
}

const HLS_MARKER = "output.file.hls(";
const ICECAST_MARKER = "output.icecast(";

describe("buildLiquidsoapScript — deliveryMode output selection", () => {
  it("emits both HLS and Icecast outputs when deliveryMode is 'both'", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "both" }));
    expect(script).toContain(HLS_MARKER);
    expect(script).toContain(ICECAST_MARKER);
  });

  it("emits only HLS when deliveryMode is 'hls'", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "hls" }));
    expect(script).toContain(HLS_MARKER);
    expect(script).not.toContain(ICECAST_MARKER);
  });

  it("emits only Icecast when deliveryMode is 'icecast'", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "icecast" }));
    expect(script).toContain(ICECAST_MARKER);
    expect(script).not.toContain(HLS_MARKER);
  });
});

describe("buildLiquidsoapScript — rendition set", () => {
  it("emits one ffmpeg/aac stream entry per HLS bitrate", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "hls", hlsBitrates: [48, 96, 192] }));
    expect(script).toContain('"aac_48"');
    expect(script).toContain('"aac_96"');
    expect(script).toContain('"aac_192"');
    expect(script).toContain('b="192k"');
  });

  it("uses the configured Icecast MP3 bitrate", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "icecast", icecastBitrate: 320 }));
    expect(script).toContain("%mp3(bitrate=320)");
  });
});

describe("buildLiquidsoapScript — interpolation safety", () => {
  it("escapes double quotes in the channel name so the script stays valid", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "icecast", name: 'The "Late" Show' }));
    expect(script).toContain('name="The \\"Late\\" Show"');
    // A raw unescaped quote would prematurely close the string literal.
    expect(script).not.toContain('name="The "Late" Show"');
  });

  it("wires the harbor port, mount, and internal auth hook into the script", () => {
    const script = buildLiquidsoapScript(params({ harborPort: 8137, mount: "/talk", internalToken: "abc123" }));
    expect(script).toContain("port=8137");
    expect(script).toContain('input.harbor(\n  "/talk"');
    expect(script).toContain('internal_token = "abc123"');
    expect(script).toContain("/internal/auth");
  });
});
