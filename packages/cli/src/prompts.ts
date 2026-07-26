import * as clack from "@clack/prompts";
import type { Prompter, SpinnerHandle } from "./context";

/**
 * The ONE library file allowed to call process.exit: a cancelled prompt must
 * abort the whole flow (Prompter contract — commands always get a value).
 */
function guard<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Cancelled.");
    process.exit(1);
  }
  return value as T;
}

export function clackPrompter(): Prompter {
  return {
    intro: (message) => clack.intro(message),
    outro: (message) => clack.outro(message),
    note: (message, title) => clack.note(message, title),
    text: async (opts) => guard(await clack.text(opts)),
    // Cast: clack's Option<T> conditional type can't resolve an unbound T.
    async select<T extends string>(opts: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
    }): Promise<T> {
      return guard(await clack.select(opts as clack.SelectOptions<T>));
    },
    confirm: async (opts) => guard(await clack.confirm(opts)),
    password: async (opts) => guard(await clack.password(opts)),
    spinner(): SpinnerHandle {
      const s = clack.spinner();
      return {
        start: (message) => s.start(message),
        message: (message) => s.message(message),
        stop: (message) => s.stop(message),
      };
    },
  };
}
