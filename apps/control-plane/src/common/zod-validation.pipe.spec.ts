import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

/** Baseline tests for the request-body validation pipe (shared zod schemas). */
const schema = z.object({ name: z.string().min(1), count: z.number().int() });

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe(schema);

  it("returns the parsed, typed value when validation passes", () => {
    const out = pipe.transform({ name: "jazz", count: 3 });
    expect(out).toEqual({ name: "jazz", count: 3 });
  });

  it("throws BadRequestException with the zod issues when validation fails", () => {
    try {
      pipe.transform({ name: "", count: 1.5 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const res = (err as BadRequestException).getResponse() as { message: string; issues: unknown[] };
      expect(res.message).toBe("Validation failed");
      expect(res.issues.length).toBeGreaterThanOrEqual(2); // empty name + non-int count
    }
  });

  it("strips unknown keys not declared in the schema", () => {
    const out = pipe.transform({ name: "talk", count: 1, injected: "x" }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("injected");
  });
});
