/**
 * Crew orchestration state — SQLite persistence.
 *
 * Three tables: tabs (iTerm2 tabs), panes (iTerm2 panes),
 * agents (screen sessions with optional pane attachment).
 */

import { Database } from "bun:sqlite";

export type Tab = {
  name: string;
  theme: string | null;
  created_at: number;
};

export type Pane = {
  name: string;
  tab: string;
  position: string;
  iterm_id: string | null;
  created_at: number;
};

export type Agent = {
  id: string;
  display_name: string;
  runtime: string;
  screen_name: string;
  screen_pid: number | null;
  pane: string | null;
  status_name: string | null;
  status_desc: string | null;
  launched_at: number;
  last_seen: number;
};

export class CrewStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tabs (
        name TEXT PRIMARY KEY,
        theme TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS panes (
        name TEXT PRIMARY KEY,
        tab TEXT NOT NULL REFERENCES tabs(name),
        position TEXT NOT NULL DEFAULT '',
        iterm_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        runtime TEXT NOT NULL DEFAULT 'claude-code',
        screen_name TEXT NOT NULL,
        screen_pid INTEGER,
        pane TEXT REFERENCES panes(name),
        status_name TEXT,
        status_desc TEXT,
        launched_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
    `);

    // Add theme column to tabs if missing
    const hasTheme = this.db.prepare(
      "SELECT * FROM pragma_table_info('tabs') WHERE name='theme'"
    ).get();
    if (!hasTheme) {
      this.db.exec("ALTER TABLE tabs ADD COLUMN theme TEXT");
    }

    // Migrate from old "slots"/"slot" schema if present
    const hasSlots = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='slots'"
    ).get();
    if (hasSlots) {
      this.db.exec(`
        INSERT OR IGNORE INTO panes (name, tab, position, iterm_id, created_at)
          SELECT name, tab, position, iterm_id, created_at FROM slots;
        DROP TABLE slots;
      `);
    }
    const hasSlotCol = this.db.prepare(
      "SELECT * FROM pragma_table_info('agents') WHERE name='slot'"
    ).get();
    if (hasSlotCol) {
      this.db.exec(`
        ALTER TABLE agents RENAME COLUMN slot TO pane;
      `);
    }
  }

  // --- Tabs ---

  createTab(name: string, theme?: string): Tab {
    const now = Date.now();
    this.db.prepare("INSERT INTO tabs (name, theme, created_at) VALUES (?, ?, ?)").run(name, theme ?? null, now);
    return { name, theme: theme ?? null, created_at: now };
  }

  setTabTheme(name: string, theme: string): void {
    this.db.prepare("UPDATE tabs SET theme = ? WHERE name = ?").run(theme, name);
  }

  getTab(name: string): Tab | null {
    return this.db.prepare("SELECT * FROM tabs WHERE name = ?").get(name) as Tab | null;
  }

  listTabs(): Tab[] {
    return this.db.prepare("SELECT * FROM tabs ORDER BY created_at").all() as Tab[];
  }

  deleteTab(name: string): void {
    this.db.prepare("DELETE FROM panes WHERE tab = ?").run(name);
    this.db.prepare("DELETE FROM tabs WHERE name = ?").run(name);
  }

  // --- Panes ---

  createPane(name: string, tab: string, position: string = ""): Pane {
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO panes (name, tab, position, created_at) VALUES (?, ?, ?, ?)"
    ).run(name, tab, position, now);
    return { name, tab, position, iterm_id: null, created_at: now };
  }

  getPane(name: string): Pane | null {
    return this.db.prepare("SELECT * FROM panes WHERE name = ?").get(name) as Pane | null;
  }

  listPanes(tab?: string): Pane[] {
    if (tab) {
      return this.db.prepare("SELECT * FROM panes WHERE tab = ? ORDER BY position").all(tab) as Pane[];
    }
    return this.db.prepare("SELECT * FROM panes ORDER BY tab, position").all() as Pane[];
  }

  setPaneItermId(name: string, itermId: string): void {
    this.db.prepare("UPDATE panes SET iterm_id = ? WHERE name = ?").run(itermId, name);
  }

  deletePane(name: string): void {
    // Detach any agent in this pane
    this.db.prepare("UPDATE agents SET pane = NULL WHERE pane = ?").run(name);
    this.db.prepare("DELETE FROM panes WHERE name = ?").run(name);
  }

  // --- Agents ---

  createAgent(agent: {
    id: string;
    display_name: string;
    runtime: string;
    screen_name: string;
    screen_pid?: number;
    pane?: string;
  }): Agent {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO agents (id, display_name, runtime, screen_name, screen_pid, pane, launched_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agent.id, agent.display_name, agent.runtime, agent.screen_name,
      agent.screen_pid ?? null, agent.pane ?? null, now, now,
    );
    return {
      id: agent.id,
      display_name: agent.display_name,
      runtime: agent.runtime,
      screen_name: agent.screen_name,
      screen_pid: agent.screen_pid ?? null,
      pane: agent.pane ?? null,
      status_name: null,
      status_desc: null,
      launched_at: now,
      last_seen: now,
    };
  }

  getAgent(id: string): Agent | null {
    return this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent | null;
  }

  listAgents(): Agent[] {
    return this.db.prepare("SELECT * FROM agents ORDER BY launched_at").all() as Agent[];
  }

  updateAgentPid(id: string, pid: number): void {
    this.db.prepare("UPDATE agents SET screen_pid = ?, last_seen = ? WHERE id = ?").run(pid, Date.now(), id);
  }

  updateAgentPane(id: string, pane: string | null): void {
    this.db.prepare("UPDATE agents SET pane = ?, last_seen = ? WHERE id = ?").run(pane, Date.now(), id);
  }

  updateAgentStatus(id: string, statusName: string, statusDesc: string): void {
    this.db.prepare(
      "UPDATE agents SET status_name = ?, status_desc = ?, last_seen = ? WHERE id = ?"
    ).run(statusName, statusDesc, Date.now(), id);
  }

  touchAgent(id: string): void {
    this.db.prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(Date.now(), id);
  }

  deleteAgent(id: string): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }
}
