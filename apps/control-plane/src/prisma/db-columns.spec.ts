import { describe, expect, it } from "vitest";
import {
  parseCdnProvider,
  parseCdnStatus,
  parseDeliveryMode,
  parseHlsBitrates,
  serializeHlsBitrates,
} from "./db-columns";

describe("hlsBitrates column mapping", () => {
  it("round-trips a bitrate list through the stored string", () => {
    expect(parseHlsBitrates(serializeHlsBitrates([64, 128]))).toEqual([64, 128]);
  });

  it("serializes to compact JSON", () => {
    expect(serializeHlsBitrates([64, 128])).toBe("[64,128]");
  });

  it("parses a single-bitrate list", () => {
    expect(parseHlsBitrates("[96]")).toEqual([96]);
  });

  it("rejects malformed JSON with a descriptive error", () => {
    expect(() => parseHlsBitrates("not-json")).toThrow(/hlsBitrates/);
  });

  it("rejects JSON that is not a bitrate list", () => {
    expect(() => parseHlsBitrates('{"a":1}')).toThrow(/hlsBitrates/);
    expect(() => parseHlsBitrates("[]")).toThrow(/hlsBitrates/);
    expect(() => parseHlsBitrates('["x"]')).toThrow(/hlsBitrates/);
    expect(() => parseHlsBitrates("[-64]")).toThrow(/hlsBitrates/);
  });
});

describe("deliveryMode column mapping", () => {
  it.each(["hls", "icecast", "both"] as const)("accepts %s", (mode) => {
    expect(parseDeliveryMode(mode)).toBe(mode);
  });

  it("rejects unknown modes", () => {
    expect(() => parseDeliveryMode("webrtc")).toThrow(/deliveryMode/);
  });
});

describe("cdn column mappings", () => {
  it("accepts known provider and statuses", () => {
    expect(parseCdnProvider("bunny")).toBe("bunny");
    expect(parseCdnStatus("disabled")).toBe("disabled");
    expect(parseCdnStatus("provisioning")).toBe("provisioning");
    expect(parseCdnStatus("active")).toBe("active");
    expect(parseCdnStatus("error")).toBe("error");
  });

  it("rejects unknown values", () => {
    expect(() => parseCdnProvider("cloudflare")).toThrow(/provider/);
    expect(() => parseCdnStatus("paused")).toThrow(/status/);
  });
});
