import { auth } from "./auth";

/**
 * Create the first admin account, server-side. Invoked by the installer
 * (`deploy/install.sh`) via `docker compose exec … node dist/auth/seed-operator.js`
 * with OPERATOR_EMAIL / OPERATOR_PASSWORD (/ OPERATOR_NAME) set.
 *
 * Sign-up self-locks after the first account (see `first-run.ts`), so this is
 * idempotent: a second run against a seeded box reports `exists`, not an error.
 */
export type SeedOperatorOutcome = "created" | "exists" | "invalid" | "error";

export interface SeedOperatorResult {
  outcome: SeedOperatorOutcome;
  message: string;
}

export interface SeedOperatorInput {
  email?: string;
  password?: string;
  name?: string;
}

export interface SeedOperatorDeps {
  signUp: (body: { email: string; password: string; name: string }) => Promise<unknown>;
}

const defaultDeps: SeedOperatorDeps = {
  signUp: (body) => auth.api.signUpEmail({ body }),
};

/** The first-run gate rejects with FORBIDDEN once an admin exists; better-auth
 * uses a "already exists" message for a duplicate email. Both mean "done". */
function isAlreadyDone(message: string): boolean {
  return /closed|already exists|exist/i.test(message);
}

export async function seedOperator(
  input: SeedOperatorInput,
  deps: SeedOperatorDeps = defaultDeps,
): Promise<SeedOperatorResult> {
  const email = input.email?.trim();
  const password = input.password;
  const name = input.name?.trim() || "Operator";

  if (!email || !password) {
    return {
      outcome: "invalid",
      message: "Set OPERATOR_EMAIL and OPERATOR_PASSWORD to create the first admin.",
    };
  }

  try {
    await deps.signUp({ email, password, name });
    return { outcome: "created", message: `Created admin: ${email}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAlreadyDone(message)) {
      return { outcome: "exists", message: "An admin already exists — sign-up is locked." };
    }
    return { outcome: "error", message: `Failed to create admin: ${message}` };
  }
}

/** CLI entrypoint — only when run directly, never on import (so tests don't exit). */
async function main(): Promise<void> {
  const result = await seedOperator({
    email: process.env.OPERATOR_EMAIL,
    password: process.env.OPERATOR_PASSWORD,
    name: process.env.OPERATOR_NAME,
  });
  const ok = result.outcome === "created" || result.outcome === "exists";
  (ok ? console.log : console.error)(result.message);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  void main();
}
