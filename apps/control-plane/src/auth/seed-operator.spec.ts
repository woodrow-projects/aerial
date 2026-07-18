import { beforeEach, describe, expect, it, vi } from "vitest";

// seed-operator imports the better-auth singleton (which builds a PrismaClient).
// Mock it so this stays a pure unit; tests inject `signUp` via deps anyway.
vi.mock("./auth", () => ({ auth: { api: { signUpEmail: vi.fn() } } }));

import { seedOperator } from "./seed-operator";

describe("seedOperator (create the first admin)", () => {
  const signUp = vi.fn();
  const deps = { signUp };

  beforeEach(() => {
    signUp.mockReset();
  });

  it("reports invalid input when email or password is missing", async () => {
    expect((await seedOperator({ password: "pw" }, deps)).outcome).toBe("invalid");
    expect((await seedOperator({ email: "a@b.c" }, deps)).outcome).toBe("invalid");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("creates the admin with the supplied credentials", async () => {
    signUp.mockResolvedValue({ user: { id: "u_1" } });
    const result = await seedOperator({ email: "ada@example.com", password: "strong-pw", name: "Ada" }, deps);
    expect(result.outcome).toBe("created");
    expect(result.message).toContain("ada@example.com");
    expect(signUp).toHaveBeenCalledWith({ email: "ada@example.com", password: "strong-pw", name: "Ada" });
  });

  it("defaults the name to 'Operator' when none is given", async () => {
    signUp.mockResolvedValue({});
    await seedOperator({ email: "a@b.c", password: "pw" }, deps);
    expect(signUp).toHaveBeenCalledWith({ email: "a@b.c", password: "pw", name: "Operator" });
  });

  it("treats a closed/self-locked sign-up as a benign 'exists' outcome", async () => {
    signUp.mockRejectedValue(new Error("Sign-up is closed: an administrator already exists."));
    const result = await seedOperator({ email: "a@b.c", password: "pw" }, deps);
    expect(result.outcome).toBe("exists");
  });

  it("treats a duplicate email as a benign 'exists' outcome", async () => {
    signUp.mockRejectedValue(new Error("User already exists"));
    const result = await seedOperator({ email: "a@b.c", password: "pw" }, deps);
    expect(result.outcome).toBe("exists");
  });

  it("surfaces an unexpected failure as an error outcome", async () => {
    signUp.mockRejectedValue(new Error("database is down"));
    const result = await seedOperator({ email: "a@b.c", password: "pw" }, deps);
    expect(result.outcome).toBe("error");
    expect(result.message).toMatch(/database is down/i);
  });
});
