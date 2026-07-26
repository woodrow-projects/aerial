import * as clack from "@clack/prompts";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clackPrompter } from "./prompts";

const CANCEL = vi.hoisted(() => Symbol("clack:cancel"));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === CANCEL),
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  password: vi.fn(),
  spinner: vi.fn(),
}));

// Generic clack fns (select) defeat vi.mocked's inference — go through Mock.
const mock = (fn: unknown) => fn as Mock;

const exitSentinel = new Error("exit(1) sentinel");

describe("clackPrompter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitSentinel;
    });
  });
  afterEach(() => {
    vi.mocked(process.exit).mockRestore();
  });

  it("delegates intro/outro/note", () => {
    const p = clackPrompter();
    p.intro("aerial");
    p.outro("done");
    p.note("body", "title");
    expect(clack.intro).toHaveBeenCalledWith("aerial");
    expect(clack.outro).toHaveBeenCalledWith("done");
    expect(clack.note).toHaveBeenCalledWith("body", "title");
  });

  it("text delegates opts and returns the value", async () => {
    mock(clack.text).mockResolvedValue("radio.example.com");
    const validate = (v: string) => (v ? undefined : "required");
    const opts = {
      message: "Domain?",
      placeholder: "radio.example.com",
      initialValue: "x",
      validate,
    };
    await expect(clackPrompter().text(opts)).resolves.toBe("radio.example.com");
    expect(clack.text).toHaveBeenCalledWith(opts);
  });

  it("select delegates opts and returns the chosen value", async () => {
    mock(clack.select).mockResolvedValue("hetzner");
    const opts = {
      message: "Provider?",
      options: [
        { value: "hetzner", label: "Hetzner", hint: "default" },
        { value: "digitalocean", label: "DigitalOcean" },
      ],
    };
    await expect(clackPrompter().select(opts)).resolves.toBe("hetzner");
    expect(clack.select).toHaveBeenCalledWith(opts);
  });

  it("confirm delegates opts and returns the boolean", async () => {
    mock(clack.confirm).mockResolvedValue(false);
    const opts = { message: "Proceed?", initialValue: true };
    await expect(clackPrompter().confirm(opts)).resolves.toBe(false);
    expect(clack.confirm).toHaveBeenCalledWith(opts);
  });

  it("password delegates opts and returns the value", async () => {
    mock(clack.password).mockResolvedValue("hunter22");
    const opts = { message: "Admin password" };
    await expect(clackPrompter().password(opts)).resolves.toBe("hunter22");
    expect(clack.password).toHaveBeenCalledWith(opts);
  });

  it("spinner delegates start/message/stop to one clack spinner", async () => {
    const handle = { start: vi.fn(), message: vi.fn(), stop: vi.fn() };
    mock(clack.spinner).mockReturnValue(handle);
    const s = clackPrompter().spinner();
    s.start("working");
    s.message("still working");
    s.stop("done");
    expect(clack.spinner).toHaveBeenCalledTimes(1);
    expect(handle.start).toHaveBeenCalledWith("working");
    expect(handle.message).toHaveBeenCalledWith("still working");
    expect(handle.stop).toHaveBeenCalledWith("done");
  });

  const cancelCases: Array<[string, () => Promise<unknown>]> = [
    ["text", () => clackPrompter().text({ message: "m" })],
    [
      "select",
      () =>
        clackPrompter().select({
          message: "m",
          options: [{ value: "a", label: "A" }],
        }),
    ],
    ["confirm", () => clackPrompter().confirm({ message: "m" })],
    ["password", () => clackPrompter().password({ message: "m" })],
  ];

  for (const [kind, invoke] of cancelCases) {
    it(`${kind}: cancel symbol prints 'Cancelled.' and exits 1`, async () => {
      mock((clack as Record<string, unknown>)[kind]).mockResolvedValue(CANCEL);
      await expect(invoke()).rejects.toBe(exitSentinel);
      expect(clack.cancel).toHaveBeenCalledWith("Cancelled.");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  }
});
