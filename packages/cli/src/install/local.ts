import type { Shell } from "../context";
import { CliError } from "../context";
import type { InstallAnswers } from "./answers";
import { installEnv } from "./answers";

/**
 * Local mode: drive deploy/install.sh on this machine. The CLI has already
 * collected every answer, so the engine runs fully non-interactively (env
 * vars, never argv) with output streamed to the user's terminal.
 */
export async function runLocalInstall(
  shell: Shell,
  stationDir: string,
  answers: InstallAnswers,
): Promise<void> {
  const code = await shell.runStreaming("bash", ["deploy/install.sh"], {
    cwd: stationDir,
    env: installEnv(answers),
  });
  if (code !== 0) {
    throw new CliError(
      "install.sh failed (see output above).",
      `Check the stack: docker compose -f deploy/docker-compose.yml logs (in ${stationDir})`,
    );
  }
}
