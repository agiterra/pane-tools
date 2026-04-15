import { describe, test, expect, beforeEach, mock } from "bun:test";
import { CrewStore } from "./store";
import { reconcile } from "./reconciler";
import type { TerminalBackend } from "./terminal";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let store: CrewStore;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "reconciler-test-"));
  store = new CrewStore(join(tmp, "test.db"));
});

function makeTerminal(aliveSessionIds: string[]): TerminalBackend {
  const alive = new Set(aliveSessionIds);
  return {
    name: "test",
    currentSessionId: mock(async () => ""),
    sessionIdForTty: mock(async () => null),
    splitPane: mock(async () => ""),
    splitSession: mock(async () => ""),
    writeToSession: mock(async () => {}),
    closeSession: mock(async () => {}),
    isSessionAlive: mock(async (id: string) => alive.has(id)),
    createTab: mock(async () => ""),
    setSessionName: mock(async () => {}),
    setBadge: mock(async () => {}),
    flashSession: mock(async () => {}),
    notifySession: mock(async () => {}),
    renameWorkspace: mock(async () => {}),
    writePaneProfile: mock(() => ""),
    writeEmptyPaneProfile: mock(() => ""),
    splitPaneWithProfile: mock(async () => ""),
    splitSessionWithProfile: mock(async () => ""),
    splitWebBrowser: mock(async () => ""),
    splitSessionWebBrowser: mock(async () => ""),
  } as unknown as TerminalBackend;
}

describe("reconcile theme healing", () => {
  test("assigns theme to untheme tab", async () => {
    store.createTab("brioche");
    const result = await reconcile(store);
    expect(result.tabsThemed.length).toBe(1);
    expect(result.tabsThemed[0].tab).toBe("brioche");
    expect(result.tabsThemed[0].theme).toBeDefined();
    expect(store.getTab("brioche")!.theme).toBe(result.tabsThemed[0].theme);
  });

  test("skips tabs that already have a theme", async () => {
    store.createTab("eng", "trees");
    const result = await reconcile(store);
    expect(result.tabsThemed.length).toBe(0);
    expect(store.getTab("eng")!.theme).toBe("trees");
  });

  test("picks unused theme when others are taken", async () => {
    store.createTab("a", "trees");
    store.createTab("b"); // no theme
    const result = await reconcile(store);
    expect(result.tabsThemed.length).toBe(1);
    expect(result.tabsThemed[0].theme).not.toBe("trees");
  });

  test("pane inherits theme from tab", async () => {
    store.createTab("eng", "trees");
    store.createPane("oak", "eng"); // no theme
    const result = await reconcile(store);
    expect(result.panesThemed.length).toBe(1);
    expect(result.panesThemed[0]).toEqual({ pane: "oak", theme: "trees" });
    expect(store.getPane("oak")!.theme).toBe("trees");
  });
});

describe("reconcile terminal session checks", () => {
  test("clears dead pane iterm_id", async () => {
    store.createTab("eng", "trees");
    store.createPane("oak", "eng");
    store.setPaneItermId("oak", "session-dead");
    const terminal = makeTerminal([]);
    const result = await reconcile(store, terminal);
    expect(result.panesCleared).toEqual(["oak"]);
    expect(store.getPane("oak")!.iterm_id).toBeNull();
  });

  test("keeps alive pane iterm_id", async () => {
    store.createTab("eng", "trees");
    store.createPane("oak", "eng");
    store.setPaneItermId("oak", "session-live");
    const terminal = makeTerminal(["session-live"]);
    const result = await reconcile(store, terminal);
    expect(result.panesCleared).toEqual([]);
    expect(store.getPane("oak")!.iterm_id).toBe("session-live");
  });

  test("clears dead tab session", async () => {
    store.createTab("eng", "trees", "session-dead");
    const terminal = makeTerminal([]);
    const result = await reconcile(store, terminal);
    expect(result.tabsCleared).toEqual(["eng"]);
    expect(store.getTab("eng")!.iterm_session_id).toBeNull();
  });

  test("skips terminal checks when backend omitted", async () => {
    store.createTab("eng", "trees");
    store.createPane("oak", "eng");
    store.setPaneItermId("oak", "session-anything");
    const result = await reconcile(store); // no terminal
    expect(result.panesCleared).toEqual([]);
    expect(result.tabsCleared).toEqual([]);
    expect(store.getPane("oak")!.iterm_id).toBe("session-anything");
  });
});
