import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { buildLiquidsoapScript, type LiquidsoapParams } from "./liq-template";

describe("emit generated script for external liquidsoap --check", () => {
  it("writes both/hls/icecast variants to /tmp", () => {
    const base: LiquidsoapParams = {
      slug: "jazz",
      name: 'Jazz "FM"',
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
    };
    writeFileSync("/tmp/gen_both.liq", buildLiquidsoapScript({ ...base, deliveryMode: "both" }));
    writeFileSync("/tmp/gen_hls.liq", buildLiquidsoapScript({ ...base, deliveryMode: "hls" }));
    writeFileSync("/tmp/gen_icecast.liq", buildLiquidsoapScript({ ...base, deliveryMode: "icecast" }));
  });
});
