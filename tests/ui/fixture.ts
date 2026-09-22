import type { PluginHostProps } from "@getpaseo/plugin/client";
import { settingsSchema, type Summary, type Settings } from "../../shared/contracts";

export const props: PluginHostProps = {
  host: { id: "preview", label: "Simulated host" },
  layout: { compact: false, platform: "web" },
  theme: {
    colors: {
      surface0: "#121212",
      surface1: "#1b1b1b",
      surface2: "#262626",
      border: "#383838",
      foreground: "#ececec",
      foregroundMuted: "#a6a6a6",
      accent: "#80bbef",
      accentForeground: "#111",
      statusSuccess: "#24bb7b",
      statusDanger: "#f05d62",
      statusWarning: "#e6b15d",
    },
  },
};
export const lightTheme: PluginHostProps["theme"] = {
  colors: {
    surface0: "#fff",
    surface1: "#fafafa",
    surface2: "#f2f2f2",
    border: "#ddd",
    foreground: "#252525",
    foregroundMuted: "#666",
    accent: "#236ec4",
    accentForeground: "#fff",
    statusSuccess: "#087b40",
    statusDanger: "#c02436",
    statusWarning: "#936300",
  },
};
export const recordId = "db0f9531-a05b-4689-a502-0555fb306c4f";
export function createFixture(longPaths = false) {
  const directory = longPaths
    ? "/Users/example/projects/review-workspace/packages/runtime/src/platforms/shared/agent"
    : "/repo/src/agent";
  const files = [`${directory}/change-tracker.ts`, "/repo/README.md"].map((path) => ({
    path,
    previousPath: path.endsWith("change-tracker.ts") ? `${directory}/old-tracker.ts` : null,
    additions: 1,
    deletions: 1,
    issue: null,
  }));
  let record: Summary = {
    id: recordId,
    agentId: "preview-agent",
    provider: "codex",
    source: "edits",
    requestedSource: "auto",
    startedAt: "2026-09-10T08:00:00Z",
    finishedAt: "2026-09-10T08:06:24Z",
    outcome: "completed",
    issues: [],
    files,
    canUndo: true,
    undoneAt: null,
    undoState: "ready",
  };
  let settings = { revision: "initial", values: settingsSchema.parse({}) };
  const state = { failUndo: false, failSource: true, sourceConflict: false, calls: [] as string[] };
  let source = {
    path: "README.md",
    absolutePath: "/repo/README.md",
    content: "editable source\n",
    revision: "one",
  };
  async function invoke(method: string, raw: unknown): Promise<unknown> {
    state.calls.push(method);
    const input = raw as { index?: number; revision?: string; values?: Settings; content?: string };
    if (method === "changes.read") return record;
    if (method === "changes.list") return [record];
    if (method === "changes.source") {
      if (state.failSource) throw new Error("The source file was deleted or moved; no actual file to open was found.");
      return source;
    }
    if (method === "changes.source.save") {
      if (state.sourceConflict || input.revision !== source.revision)
        throw new Error("The source file changed or moved elsewhere; not saved. Your draft was kept.");
      source = { ...source, content: input.content!, revision: source.revision + "-saved" };
      return source;
    }
    if (method === "changes.file") {
      const file = files[input.index!];
      return {
        ...file,
        patch: `--- ${file.path}\n+++ ${file.path}\n@@ -1 +1 @@\n-${input.index === 0 ? "const source = 'git';" : "old description"}\n+${input.index === 0 ? "const source = 'native';" : "Show file changes per turn"}\n`,
      };
    }
    if (method === "changes.undo") {
      if (state.failUndo) throw new Error("The file has later changes; no files were undone.");
      record = { ...record, canUndo: false, undoState: "done", undoneAt: new Date().toISOString() };
      return record;
    }
    if (method === "sources.read") return settings;
    if (method === "sources.native-status")
      return { codex: { available: false, observedAt: "2026-09-11T08:00:00Z" } };
    if (method === "sources.save") {
      if (input.revision !== settings.revision)
        throw new Error("Settings were changed elsewhere; refresh and save again.");
      settings = {
        revision: String(Number(settings.revision) + 1 || 1),
        values: settingsSchema.parse(input.values),
      };
      return settings;
    }
    throw new Error(`Unknown fixture RPC: ${method}`);
  }
  return { invoke, state, settings: () => settings };
}
