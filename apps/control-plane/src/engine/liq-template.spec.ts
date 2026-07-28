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

// Exact encoder strings the template must emit (ADR D2). HE-AAC on the low rung
// only; higher rungs stay AAC-LC.
const HE_AAC_64 = '("aac_64", %ffmpeg(format="mpegts", %audio(codec="libfdk_aac", b="64k", profile="aac_he")))';
const LC_AAC_128 = '("aac_128", %ffmpeg(format="mpegts", %audio(codec="aac", b="128k")))';
// Loudness (ADR D12): LUFS-based EBU R128 normalization at streaming target.
const LOUDNESS = "normalize(radio, lufs=true, target=-16.0)";

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

describe("buildLiquidsoapScript — loudness normalization (EBU R128, D12)", () => {
  it("normalizes the stream in LUFS at the -16 LUFS streaming target", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "both" }));
    expect(script).toContain(LOUDNESS);
    // LUFS mode is what makes this loudness (R128 units), not plain RMS.
    expect(script).toContain("lufs=true");
    expect(script).toContain("target=-16.0");
  });

  it("no longer ships the plain normalize() placeholder", () => {
    const script = buildLiquidsoapScript(params());
    // The old placeholder had a bare normalize(radio) with no LUFS target.
    expect(script).not.toContain("normalize(radio)\n");
    expect(script).not.toMatch(/placeholder/i);
  });

  it("normalizes the shared source before the outputs, so both HLS and Icecast are normalized", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "both" }));
    const loudnessAt = script.indexOf(LOUDNESS);
    const hlsAt = script.indexOf(HLS_MARKER);
    const icecastAt = script.indexOf(ICECAST_MARKER);
    expect(loudnessAt).toBeGreaterThanOrEqual(0);
    expect(loudnessAt).toBeLessThan(hlsAt);
    expect(loudnessAt).toBeLessThan(icecastAt);
  });
});

describe("buildLiquidsoapScript — HE-AAC low rung (D2)", () => {
  it("emits HE-AAC for the 64k rung and AAC-LC for the 128k rung", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "hls", hlsBitrates: [64, 128] }));
    expect(script).toContain(HE_AAC_64);
    expect(script).toContain(LC_AAC_128);
  });

  it("does not apply the HE-AAC profile to the 128k rung", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "hls", hlsBitrates: [64, 128] }));
    expect(script).not.toContain('b="128k", profile="aac_he"');
  });

  it("keeps a lone high rung on the native AAC-LC encoder (no HE-AAC)", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "hls", hlsBitrates: [128] }));
    expect(script).toContain(LC_AAC_128);
    expect(script).not.toContain("libfdk_aac");
    expect(script).not.toContain("aac_he");
  });

  it("treats the 64k boundary as the HE-AAC low rung", () => {
    const script = buildLiquidsoapScript(params({ deliveryMode: "hls", hlsBitrates: [48, 64, 96] }));
    // <=64k -> HE-AAC
    expect(script).toContain('("aac_48", %ffmpeg(format="mpegts", %audio(codec="libfdk_aac", b="48k", profile="aac_he")))');
    expect(script).toContain('("aac_64", %ffmpeg(format="mpegts", %audio(codec="libfdk_aac", b="64k", profile="aac_he")))');
    // >64k -> AAC-LC
    expect(script).toContain('("aac_96", %ffmpeg(format="mpegts", %audio(codec="aac", b="96k")))');
  });
});
