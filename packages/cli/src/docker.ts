import { CliError, type Ctx, type Shell } from "./context";

const INSTALL_SCRIPT = "curl -fsSL https://get.docker.com | sh";

/** Both must exit 0: Engine alone is not enough — install.sh needs compose v2. */
async function dockerPresent(shell: Shell): Promise<boolean> {
  const docker = await shell.run("docker", ["--version"]);
  if (docker.code !== 0) return false;
  const compose = await shell.run("docker", ["compose", "version"]);
  return compose.code === 0;
}

/**
 * Local-mode prerequisite (docs/plans/aerial-cli.md): Linux offers the
 * official convenience script with explicit consent; macOS explains and stops
 * (never auto-install a GUI app).
 */
export async function ensureLocalDocker(
  ctx: Pick<Ctx, "shell" | "prompter" | "platform">,
): Promise<void> {
  if (await dockerPresent(ctx.shell)) return;

  if (ctx.platform === "darwin") {
    throw new CliError(
      "Docker is required but was not found on this Mac.",
      "Install Docker Desktop (https://docs.docker.com/desktop/) or OrbStack (https://orbstack.dev), start it, then re-run.",
    );
  }
  if (ctx.platform !== "linux") {
    throw new CliError(
      `Docker is required but was not found, and automatic install is not supported on "${ctx.platform}".`,
      "Install Docker manually (https://docs.docker.com/engine/install/) and re-run.",
    );
  }

  const consent = await ctx.prompter.confirm({
    message: `Docker was not found. Install it now with Docker's official convenience script (${INSTALL_SCRIPT})? This makes root-level changes to this system.`,
    initialValue: false,
  });
  if (!consent) {
    throw new CliError(
      "Docker is required to run a local station.",
      "Install Docker Engine yourself (https://docs.docker.com/engine/install/) and re-run.",
    );
  }

  await ctx.shell.runStreaming("sh", ["-c", INSTALL_SCRIPT]);

  if (!(await dockerPresent(ctx.shell))) {
    throw new CliError(
      "Docker is still not available after the install script ran.",
      "Check the script output above, install Docker manually (https://docs.docker.com/engine/install/), and re-run.",
    );
  }
}
