/**
 * Read the Claude Code session ID for the current process.
 *
 * CC persists session data at ~/.claude/sessions/<PID>.json.
 * MCP servers are direct children of the CC process, so process.ppid
 * gives us the CC PID. The session ID is stable across process restarts
 * — the same CC session can resume into a new PID.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export function getClaudeCodeSessionId(): string | null {
  const sessionsDir = join(process.env.HOME ?? "/tmp", ".claude", "sessions");
  const sessionFile = join(sessionsDir, `${process.ppid}.json`);
  if (!existsSync(sessionFile)) return null;
  try {
    const data = JSON.parse(readFileSync(sessionFile, "utf-8"));
    return data.sessionId ?? null;
  } catch {
    return null;
  }
}
