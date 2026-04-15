/**
 * Reconciler — sync SQLite state with actual terminal + screen reality.
 *
 * Covers three drift surfaces:
 * 1. Agents ↔ screen sessions (dead agents cleaned up, orphan screens flagged)
 * 2. Panes ↔ terminal sessions (pane.iterm_id cleared if session gone)
 * 3. Tabs ↔ terminal sessions + theme sanity (missing themes auto-assigned,
 *    dead iterm_session_id cleared)
 */

import { CrewStore, type Agent } from "./store.js";
import { listSessions, type ScreenSession } from "./screen.js";
import { listThemes } from "./themes.js";
import type { TerminalBackend } from "./terminal.js";

export type ReconcileResult = {
  alive: string[];
  dead: string[];
  orphans: ScreenSession[];
  panesCleared: string[];
  tabsCleared: string[];
  tabsThemed: Array<{ tab: string; theme: string }>;
  panesThemed: Array<{ pane: string; theme: string }>;
};

/**
 * Reconcile DB state with running screen sessions and terminal state.
 *
 * Terminal backend is optional — if omitted, pane/tab session checks are
 * skipped. Theme healing runs unconditionally.
 */
export async function reconcile(
  store: CrewStore,
  terminal?: TerminalBackend,
): Promise<ReconcileResult> {
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
      store.updateAgentPid(agent.id, session.pid);
      store.touchAgent(agent.id);
      alive.push(agent.id);
    } else {
      store.deleteAgent(agent.id);
      dead.push(agent.id);
    }
  }

  const orphans = sessions.filter(
    (s) => s.name.startsWith("wire-") && !knownScreenNames.has(s.name),
  );

  // --- Pane session check ---
  const panesCleared: string[] = [];
  if (terminal) {
    for (const pane of store.listPanes()) {
      if (!pane.iterm_id) continue;
      const alive = await terminal.isSessionAlive(pane.iterm_id).catch(() => false);
      if (!alive) {
        store.clearPaneItermId(pane.name);
        panesCleared.push(pane.name);
      }
    }
  }

  // --- Tab session check + theme heal ---
  const tabsCleared: string[] = [];
  const tabsThemed: Array<{ tab: string; theme: string }> = [];
  const availableThemes = listThemes();

  for (const tab of store.listTabs()) {
    if (terminal && tab.iterm_session_id) {
      const alive = await terminal.isSessionAlive(tab.iterm_session_id).catch(() => false);
      if (!alive) {
        store.clearTabSession(tab.name);
        tabsCleared.push(tab.name);
      }
    }

    if (!tab.theme && availableThemes.length > 0) {
      const usedThemes = new Set(
        store.listTabs().map((t) => t.theme).filter(Boolean) as string[],
      );
      const picked = availableThemes.find((t) => !usedThemes.has(t)) ?? availableThemes[0];
      store.setTabTheme(tab.name, picked);
      tabsThemed.push({ tab: tab.name, theme: picked });
    }
  }

  // --- Pane theme heal (inherit from tab) ---
  const panesThemed: Array<{ pane: string; theme: string }> = [];
  for (const pane of store.listPanes()) {
    if (pane.theme) continue;
    const tab = store.getTab(pane.tab);
    if (tab?.theme) {
      store.setPaneTheme(pane.name, tab.theme);
      panesThemed.push({ pane: pane.name, theme: tab.theme });
    }
  }

  return { alive, dead, orphans, panesCleared, tabsCleared, tabsThemed, panesThemed };
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
  if (result.panesCleared.length > 0) {
    lines.push(`${result.panesCleared.length} pane(s) with dead terminal session: ${result.panesCleared.join(", ")}`);
  }
  if (result.tabsCleared.length > 0) {
    lines.push(`${result.tabsCleared.length} tab(s) with dead terminal session: ${result.tabsCleared.join(", ")}`);
  }
  if (result.tabsThemed.length > 0) {
    lines.push(`${result.tabsThemed.length} tab(s) auto-themed: ${result.tabsThemed.map((t) => `${t.tab}→${t.theme}`).join(", ")}`);
  }
  if (result.panesThemed.length > 0) {
    lines.push(`${result.panesThemed.length} pane(s) theme inherited from tab: ${result.panesThemed.map((p) => `${p.pane}→${p.theme}`).join(", ")}`);
  }

  for (const agent of agents) {
    const status = agent.status_name ? ` [${agent.status_name}]` : "";
    const location = agent.pane ? `pane:${agent.pane}` : "detached";
    lines.push(`  ${agent.id} (${agent.display_name}) — ${location}${status}`);
  }

  return lines.join("\n");
}
