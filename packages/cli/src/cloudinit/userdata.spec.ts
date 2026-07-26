import { describe, expect, it } from "vitest";
import { dockerInstallUserData } from "./userdata";

describe("dockerInstallUserData", () => {
  it("takes zero parameters (cannot receive a secret, so cannot leak one)", () => {
    expect(dockerInstallUserData.length).toBe(0);
  });

  it("starts with a bash shebang and fails fast", () => {
    const script = dockerInstallUserData();
    expect(script.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(script).toContain("set -euo pipefail");
  });

  it("installs Docker via get.docker.com and enables the service", () => {
    const script = dockerInstallUserData();
    expect(script).toContain("curl -fsSL https://get.docker.com | sh");
    expect(script).toContain("systemctl enable --now docker");
  });

  it("is a constant with no interpolation artifacts", () => {
    expect(dockerInstallUserData()).toBe(dockerInstallUserData());
    expect(dockerInstallUserData()).not.toContain("${");
  });
});
