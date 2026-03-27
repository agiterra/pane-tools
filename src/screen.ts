/**
 * GNU screen session management.
 *
 * Agents run inside named screen sessions. Screen provides:
 * - Persistent processes that survive terminal crashes
 * - Detach/reattach without interrupting the process
 * - Headless I/O via screen -X stuff (send keystrokes) and screen -X hardcopy (read output)
 */

import { $ } from "bun";

export type ScreenSession = {
  name: string;
  pid: number;
};

/**
 * Create a detached screen session running a command.
 * Returns the screen session name and PID.
 */
export async function createSession(
  name: string,
  command: string,
): Promise<ScreenSession> {
  // Create detached screen session
  await $`screen -dmS ${name} bash -c ${command}`.quiet();

  // Get the screen PID
  const pid = await getSessionPid(name);
  if (pid === null) {
    throw new Error(`screen session '${name}' failed to start`);
  }
  return { name, pid };
}

/**
 * List all screen sessions.
 */
export async function listSessions(): Promise<ScreenSession[]> {
  try {
    const result = await $`screen -ls`.quiet().nothrow();
    const output = result.stdout.toString();
    const sessions: ScreenSession[] = [];
    for (const line of output.split("\n")) {
      // Format: "	12345.name	(Detached)" or "(Attached)"
      const match = line.match(/^\t(\d+)\.(\S+)\t/);
      if (match) {
        sessions.push({ name: match[2], pid: parseInt(match[1]) });
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Get PID of a named screen session, or null if not running.
 */
export async function getSessionPid(name: string): Promise<number | null> {
  const sessions = await listSessions();
  const session = sessions.find((s) => s.name === name);
  return session?.pid ?? null;
}

/**
 * Check if a screen session is alive.
 */
export async function isAlive(name: string): Promise<boolean> {
  return (await getSessionPid(name)) !== null;
}

/**
 * Send keystrokes to a screen session (works even when detached).
 */
export async function sendKeys(name: string, text: string): Promise<void> {
  await $`screen -S ${name} -X stuff ${text}`.quiet();
}

/**
 * Read the current screen buffer contents.
 */
export async function readOutput(name: string): Promise<string> {
  const tmpFile = `/tmp/screen-hardcopy-${name}-${Date.now()}`;
  try {
    await $`screen -S ${name} -X hardcopy ${tmpFile}`.quiet();
    const content = await Bun.file(tmpFile).text();
    await $`rm -f ${tmpFile}`.quiet();
    return content.trimEnd();
  } catch (e) {
    throw new Error(`failed to read screen output for '${name}': ${e}`);
  }
}

/**
 * Kill a screen session.
 */
export async function killSession(name: string): Promise<void> {
  await $`screen -S ${name} -X quit`.quiet().nothrow();
}
