/**
 * Injected capabilities every command runs against. Commands never touch
 * child_process, @clack/prompts, or process.exit directly — they receive a
 * `Ctx` so unit tests can fake the world (ADR D14).
 */

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOpts {
  cwd?: string;
  /** ADDITIONAL env vars — the impl merges these over the parent process env. */
  env?: Record<string, string>;
  /** Piped to the child's stdin (used to keep secrets off argv). */
  stdin?: string;
}

/** All process execution goes through this seam. */
export interface Shell {
  /** Capture stdout/stderr; never throws on non-zero exit. */
  run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult>;
  /** Inherit stdio (live streaming / interactive); resolves with exit code. */
  runStreaming(cmd: string, args: string[], opts?: RunOpts): Promise<number>;
}

export interface SpinnerHandle {
  start(message: string): void;
  message(message: string): void;
  stop(message?: string): void;
}

/**
 * Interactive prompt seam (implemented over @clack/prompts). Implementations
 * handle cancellation themselves (clean exit) — commands always get a value.
 */
export interface Prompter {
  intro(message: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  text(opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  select<T extends string>(opts: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
  }): Promise<T>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
  password(opts: {
    message: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  spinner(): SpinnerHandle;
}

/** Thrown for expected, user-facing failures; index.ts prints and exits. */
export class CliError extends Error {
  constructor(
    message: string,
    /** Optional remediation hint printed under the error. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface Ctx {
  prompter: Prompter;
  shell: Shell;
  fetch: typeof globalThis.fetch;
  platform: NodeJS.Platform;
  /** Absolute paths — overridden in tests to temp dirs. */
  paths: import("./paths").Paths;
}
