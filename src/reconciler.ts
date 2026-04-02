/**
 * Agent reconciler — sync SQLite state with actual screen sessions.
 *
 * Same pattern as the Wire session reconciler:
 * 1. Read all agents from DB
 * 2. Check screen -ls for live sessions
 * 3. Mark dead agents, clear their panes
 * 4. Flag orphan screen sessions
 */

import { CrewStore, type Agent } from "./store.js";
import { listSessions, type ScreenSession } from "./screen.js";

export type ReconcileResult = {
  alive: string[];
  dead: string[];
  orphans: ScreenSession[];
};

/**
 * Reconcile DB state with running screen sessions.
 */
export async function reconcile(store: CrewStore): Promise<ReconcileResult> {
  const agents = store.listAgents();
  const sessions = await listSessions();
  const sessionByName = new Map(sessions.map((s) => [s.name, s]));

  const alive: string[] = [];
  const dead: string[] = [];
  const knownScreenNames = new Set<string>();

  for (const agent of agents) {
    knownScreenNames.add(agent.screen_name);
    const session = sessionByName.get(agent.screen_name);

    if (session) {
      // Alive — update PID and last_seen
      store.updateAgentPid(agent.id, session.pid);
      store.touchAgent(agent.id);
      alive.push(agent.id);
    } else {
      // Dead — clear pane, remove from DB
      store.deleteAgent(agent.id);
      dead.push(agent.id);
    }
  }

  // Find orphan screen sessions (not tracked in DB)
  // Only flag sessions with our naming prefix
  const orphans = sessions.filter(
    (s) => s.name.startsWith("wire-") && !knownScreenNames.has(s.name),
  );

  return { alive, dead, orphans };
}

/**
 * Format a reconcile result as a human-readable boot report.
 */
export function formatReport(result: ReconcileResult, agents: Agent[]): string {
  const lines: string[] = [];
  const attached = agents.filter((a) => a.pane);
  const detached = agents.filter((a) => !a.pane);

  lines.push(`${agents.length} agent(s): ${attached.length} attached, ${detached.length} detached`);

  if (result.dead.length > 0) {
    lines.push(`${result.dead.length} dead agent(s) cleaned up: ${result.dead.join(", ")}`);
  }
  if (result.orphans.length > 0) {
    lines.push(`${result.orphans.length} orphan screen session(s): ${result.orphans.map((o) => o.name).join(", ")}`);
  }

  for (const agent of agents) {
    const status = agent.status_name ? ` [${agent.status_name}]` : "";
    const location = agent.pane ? `pane:${agent.pane}` : "detached";
    lines.push(`  ${agent.id} (${agent.display_name}) — ${location}${status}`);
  }

  return lines.join("\n");
}
