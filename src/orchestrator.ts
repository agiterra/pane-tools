/**
 * Pane orchestrator — high-level agent lifecycle management.
 *
 * Composes store, screen, runtimes, and reconciler into the operations
 * that MCP adapters expose as tools.
 */

import { join } from "path";
import { PaneStore, type Agent, type Tab, type Slot } from "./store.js";
import * as screen from "./screen.js";
import { getLaunchCommand } from "./runtimes.js";
import { reconcile, formatReport } from "./reconciler.js";

const DEFAULT_DB = join(process.env.HOME ?? "/tmp", ".wire", "panes.db");
const SCREEN_PREFIX = "wire-";

export class Orchestrator {
  readonly store: PaneStore;

  constructor(dbPath: string = DEFAULT_DB) {
    this.store = new PaneStore(dbPath);
  }

  // --- Agent lifecycle ---

  /**
   * Launch an agent in a screen session.
   * The agent runs in background — no pane attachment required.
   */
  async launchAgent(opts: {
    id: string;
    displayName: string;
    runtime?: string;
    projectDir?: string;
    extraFlags?: string;
  }): Promise<Agent> {
    const runtime = opts.runtime ?? "claude-code";
    const screenName = `${SCREEN_PREFIX}${opts.id}`;

    // Check for existing agent
    const existing = this.store.getAgent(opts.id);
    if (existing) {
      const alive = await screen.isAlive(existing.screen_name);
      if (alive) {
        throw new Error(`agent '${opts.id}' is already running`);
      }
      // Dead agent — clean up stale record
      this.store.deleteAgent(opts.id);
    }

    // Build launch command
    const wireUrl = process.env.WIRE_URL ?? "http://localhost:9800";
    let command = getLaunchCommand(runtime, {
      AGENT_ID: opts.id,
      AGENT_NAME: opts.displayName,
      WIRE_URL: wireUrl,
      PROJECT_DIR: opts.projectDir ?? process.cwd(),
    });
    if (opts.extraFlags) {
      command += ` ${opts.extraFlags}`;
    }

    // Create screen session
    const session = await screen.createSession(screenName, command);

    // Record in DB
    return this.store.createAgent({
      id: opts.id,
      display_name: opts.displayName,
      runtime,
      screen_name: screenName,
      screen_pid: session.pid,
    });
  }

  /**
   * Stop an agent — sends exit to screen session.
   */
  async stopAgent(id: string): Promise<void> {
    const agent = this.store.getAgent(id);
    if (!agent) throw new Error(`agent '${id}' not found`);

    await screen.killSession(agent.screen_name);
    this.store.deleteAgent(id);
  }

  /**
   * Attach an agent to a slot (make it visible in a pane).
   */
  attachAgent(agentId: string, slotName: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`agent '${agentId}' not found`);
    const slot = this.store.getSlot(slotName);
    if (!slot) throw new Error(`slot '${slotName}' not found`);

    // Detach any agent currently in this slot
    const occupants = this.store.listAgents().filter((a) => a.slot === slotName);
    for (const occ of occupants) {
      this.store.updateAgentSlot(occ.id, null);
    }

    this.store.updateAgentSlot(agentId, slotName);
  }

  /**
   * Detach an agent from its slot (agent keeps running in background).
   */
  detachAgent(agentId: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`agent '${agentId}' not found`);
    this.store.updateAgentSlot(agentId, null);
  }

  /**
   * Move an agent to a different slot.
   */
  moveAgent(agentId: string, toSlot: string): void {
    this.attachAgent(agentId, toSlot);
  }

  /**
   * Swap two agents' slots.
   */
  swapAgents(agentIdA: string, agentIdB: string): void {
    const a = this.store.getAgent(agentIdA);
    const b = this.store.getAgent(agentIdB);
    if (!a) throw new Error(`agent '${agentIdA}' not found`);
    if (!b) throw new Error(`agent '${agentIdB}' not found`);

    const slotA = a.slot;
    const slotB = b.slot;
    this.store.updateAgentSlot(agentIdA, slotB);
    this.store.updateAgentSlot(agentIdB, slotA);
  }

  /**
   * Send keystrokes to an agent's screen session.
   */
  async sendToAgent(agentId: string, text: string): Promise<void> {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`agent '${agentId}' not found`);
    await screen.sendKeys(agent.screen_name, text);
  }

  /**
   * Read an agent's current screen output.
   */
  async readAgent(agentId: string): Promise<string> {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`agent '${agentId}' not found`);
    return screen.readOutput(agent.screen_name);
  }

  /**
   * Update an agent's status.
   */
  setAgentStatus(agentId: string, statusName: string, statusDesc: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`agent '${agentId}' not found`);
    this.store.updateAgentStatus(agentId, statusName, statusDesc);
  }

  /**
   * List all agents with their current state.
   */
  listAgents(): Agent[] {
    return this.store.listAgents();
  }

  // --- Tabs ---

  createTab(name: string): Tab {
    return this.store.createTab(name);
  }

  listTabs(): Tab[] {
    return this.store.listTabs();
  }

  deleteTab(name: string): void {
    this.store.deleteTab(name);
  }

  // --- Slots ---

  createSlot(tab: string, name: string, position: string = ""): Slot {
    if (!this.store.getTab(tab)) throw new Error(`tab '${tab}' not found`);
    return this.store.createSlot(name, tab, position);
  }

  listSlots(tab?: string): Slot[] {
    return this.store.listSlots(tab);
  }

  deleteSlot(name: string): void {
    this.store.deleteSlot(name);
  }

  // --- Reconciler ---

  /**
   * Reconcile DB state with running screen sessions.
   * Run on boot and periodically.
   */
  async reconcile(): Promise<string> {
    const result = await reconcile(this.store);
    const agents = this.store.listAgents();
    return formatReport(result, agents);
  }
}
