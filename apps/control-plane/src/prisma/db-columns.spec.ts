import { describe, expect, it } from "vitest";
import {
  parseCdnProvider,
  parseCdnStatus,
  parseDaysOfWeek,
  parseDeliveryMode,
  parseHhmm,
  parseHlsBitrates,
  parsePlaylistOrder,
  parseShowType,
  serializeDaysOfWeek,
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

describe("playlistOrder column mapping", () => {
  it.each(["shuffle", "sequential", "random"] as const)("accepts %s", (order) => {
    expect(parsePlaylistOrder(order)).toBe(order);
  });

  it("rejects unknown orders", () => {
    expect(() => parsePlaylistOrder("weighted")).toThrow(/playlist order/);
  });
});

describe("showType column mapping", () => {
  it.each(["scheduled", "live"] as const)("accepts %s", (type) => {
    expect(parseShowType(type)).toBe(type);
  });

  it("rejects unknown types", () => {
    expect(() => parseShowType("prerecorded")).toThrow(/show type/);
  });
});

describe("daysOfWeek column mapping", () => {
  it("round-trips a day list through the stored string", () => {
    expect(parseDaysOfWeek(serializeDaysOfWeek([0, 1, 2, 3, 4, 5, 6]))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("serializes to compact JSON", () => {
    expect(serializeDaysOfWeek([1, 3, 5])).toBe("[1,3,5]");
  });

  it("parses a single-day list", () => {
    expect(parseDaysOfWeek("[0]")).toEqual([0]);
  });

  it("rejects malformed JSON with a descriptive error", () => {
    expect(() => parseDaysOfWeek("not-json")).toThrow(/daysOfWeek/);
  });

  it("rejects JSON that is not a valid day list", () => {
    expect(() => parseDaysOfWeek('{"a":1}')).toThrow(/daysOfWeek/);
    expect(() => parseDaysOfWeek("[]")).toThrow(/daysOfWeek/); // must name at least one day
    expect(() => parseDaysOfWeek("[7]")).toThrow(/daysOfWeek/); // out of 0-6 range
    expect(() => parseDaysOfWeek("[-1]")).toThrow(/daysOfWeek/);
    expect(() => parseDaysOfWeek("[1.5]")).toThrow(/daysOfWeek/);
    expect(() => parseDaysOfWeek("[1,1]")).toThrow(/daysOfWeek/); // duplicates
  });

  it("rejects duplicate days on serialize", () => {
    expect(() => serializeDaysOfWeek([1, 1])).toThrow();
  });
});

describe("hhmm column mapping", () => {
  it.each(["00:00", "09:05", "13:30", "23:59"])("accepts %s", (t) => {
    expect(parseHhmm(t)).toBe(t);
  });

  it("rejects malformed clock times", () => {
    expect(() => parseHhmm("24:00")).toThrow(/HH:MM/);
    expect(() => parseHhmm("9:00")).toThrow(/HH:MM/);
    expect(() => parseHhmm("12:60")).toThrow(/HH:MM/);
    expect(() => parseHhmm("noon")).toThrow(/HH:MM/);
  });
});
