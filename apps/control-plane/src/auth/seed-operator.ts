import { auth } from "./auth";

/**
 * One-off: create the first operator account. Run once after the first deploy
 * WHILE AUTH_DISABLE_SIGNUP is unset/false:
 *   docker compose exec control-plane node dist/auth/seed-operator.js
 * with OPERATOR_EMAIL / OPERATOR_PASSWORD (/ OPERATOR_NAME) set. Then set
 * AUTH_DISABLE_SIGNUP=true and redeploy to lock public registration.
 */
async function main(): Promise<void> {
  const email = process.env.OPERATOR_EMAIL;
  const password = process.env.OPERATOR_PASSWORD;
  const name = process.env.OPERATOR_NAME ?? "Operator";

  if (!email || !password) {
    console.error("Set OPERATOR_EMAIL and OPERATOR_PASSWORD to seed the first operator.");
    process.exit(1);
  }

  try {
    await auth.api.signUpEmail({ body: { email, password, name } });
    console.log(`Seeded operator: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to seed operator:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
