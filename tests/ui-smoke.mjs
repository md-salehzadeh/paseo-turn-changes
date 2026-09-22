import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "tmp");
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["tests/ui/entry.tsx"],
  outfile: "tmp/ui-preview.js",
  bundle: true,
  format: "iife",
  globalName: "TurnPreview",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  alias: {
    "react-native": "react-native-web",
    "@getpaseo/plugin/client/react-native": "./tests/ui/host.tsx",
    "@getpaseo/plugin/client/ui": "./tests/ui/host.tsx",
  },
});
const script = await readFile(path.join(output, "ui-preview.js"), "utf8");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Turn Changes · Interactive preview</title><style>body{margin:0}button,select,input{font:inherit;padding:7px 10px;border:1px solid #888;border-radius:6px}button{cursor:pointer}h3{margin:0}</style><div id="root"></div><script>${script.replace(/<\/script/gi, "<\\/script")}</script></html>`;
await writeFile(path.join(output, "preview.html"), html);
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
dom.window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});
dom.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.eval(`${script}\nwindow.TurnPreview = TurnPreview;`);
const document = dom.window.document;
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`UI assertion timed out: ${document.body.textContent}`);
}
function click(label) {
  const button = [...document.querySelectorAll('button,[role="button"]')].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  );
  assert.ok(button, `missing button: ${label}`);
  button.click();
}
try {
  await until(() => document.body.textContent.includes("Edited 2 files"));
  const card = document.querySelector('[data-testid="turn-changes-card"]');
  assert.ok(card.textContent.includes("/repo/src/agent/change-tracker.ts"));
  assert.ok(card.textContent.includes("Renamed from /repo/src/agent/old-tracker.ts"));
  assert.equal(card.textContent.includes("file edit record summary"), false);
  assert.equal(card.textContent.includes("auto-select"), false);
  assert.ok(document.body.textContent.includes("+2"));
  assert.ok(document.body.textContent.includes("−2"));
  const filePath = card.querySelector('[data-testid="turn-file-path"]');
  assert.equal(filePath.title, "/repo/src/agent/change-tracker.ts");
  assert.equal(
    filePath.querySelector('[data-testid="turn-file-basename"]').textContent,
    "/change-tracker.ts",
  );
  click("Copy full path /repo/src/agent/change-tracker.ts");
  await until(() => dom.window.TurnPreview.clipboard.text === "/repo/src/agent/change-tracker.ts");
  assert.equal(dom.window.TurnPreview.openedPanels.length, 0);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  dom.window.TurnPreview.clipboard.fail = true;
  click("Copy full path /repo/src/agent/old-tracker.ts");
  await until(() => document.querySelector('[title="Copy failed, press to retry"]'));
  assert.equal(dom.window.TurnPreview.clipboard.text, "/repo/src/agent/change-tracker.ts");
  dom.window.TurnPreview.clipboard.fail = false;
  click("Copy full path /repo/src/agent/old-tracker.ts");
  await until(() => dom.window.TurnPreview.clipboard.text === "/repo/src/agent/old-tracker.ts");
  assert.equal(dom.window.TurnPreview.openedPanels.length, 0);
  click("Review");
  await until(() => document.body.textContent.includes("const source = 'native';"));
  assert.ok(
    document.querySelector("aside").textContent.includes("Renamed from /repo/src/agent/old-tracker.ts"),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(dom.window.TurnPreview.openedPanels[0])), {
    id: "review",
    workspaceId: "preview-workspace",
    agentId: "preview-agent",
    location: "explorer",
  });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.querySelector('[aria-label="old line 1"]'));
  assert.ok(document.querySelector('[aria-label="new line 1"]'));
  assert.ok(document.querySelector('[data-testid="turn-diff-add"]'));
  assert.ok(document.querySelector('[data-testid="turn-diff-delete"]'));
  assert.equal(document.body.textContent.includes("--- src/"), false);
  click("Open source file");
  await until(() => document.body.textContent.includes("The source file was deleted or moved"));
  assert.ok(dom.window.TurnPreview.fixture.state.calls.includes("changes.source"));
  click("Next file");
  await until(() => document.body.textContent.includes("Show file changes per turn"));
  assert.equal(document.body.textContent.includes("The source file was deleted or moved"), false);
  dom.window.TurnPreview.fixture.state.failSource = false;
  const panelCount = dom.window.TurnPreview.openedPanels.length;
  click("Open source file");
  await until(() => document.querySelector('[data-testid="turn-source-input"]'));
  assert.equal(dom.window.location.href, "http://localhost/");
  assert.equal(dom.window.TurnPreview.openedPanels.length, panelCount);
  assert.ok(document.querySelector('aside [data-testid="turn-source-editor"]'));
  const sourceInput = document.querySelector('[data-testid="turn-source-input"]');
  const setSource = (value) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(
      sourceInput,
      value,
    );
    sourceInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  setSource("draft source\n");
  await until(() => document.body.textContent.includes("Unsaved"));
  click("Back to diff");
  await until(() => document.body.textContent.includes("There are unsaved changes"));
  click("Keep editing");
  dom.window.TurnPreview.fixture.state.sourceConflict = true;
  click("Save");
  await until(() => document.body.textContent.includes("Your draft was kept"));
  assert.equal(sourceInput.value, "draft source\n");
  dom.window.TurnPreview.fixture.state.sourceConflict = false;
  click("Save");
  await until(() => document.body.textContent.includes("Saved"));
  click("Back to diff");
  await until(() => !document.querySelector('[data-testid="turn-source-editor"]'));
  assert.ok(document.body.textContent.includes("2 / 2"));
  click("Show file list");
  await until(() => document.querySelector('[data-testid="turn-file-tree"]'));
  click("Collapse folder /repo/src/agent");
  await until(
    () => !document.querySelector('[aria-label="Select file /repo/src/agent/change-tracker.ts"]'),
  );
  click("Expand folder /repo/src/agent");
  await until(() =>
    document.querySelector('[aria-label="Select file /repo/src/agent/change-tracker.ts"]'),
  );
  click("Select file /repo/src/agent/change-tracker.ts");
  await until(() => !document.querySelector('[data-testid="turn-file-tree"]'));
  await until(() => document.body.textContent.includes("const source = 'native';"));
  click("Show file list");
  await until(() => document.querySelector('[aria-label="Filter changed files"]'));
  const search = document.querySelector('[aria-label="Filter changed files"]');
  const setInput = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  setInput.call(search, "missing-file");
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await until(() => document.body.textContent.includes("No matching files"));
  setInput.call(search, "readme");
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await until(() => document.querySelectorAll('[data-testid="turn-file-entry"]').length === 1);
  click("Select file /repo/README.md");
  await until(() => document.body.textContent.includes("Show file changes per turn"));
  click("Close review panel");
  await until(() => !document.querySelector("aside"));
  click("View this turn's changes for /repo/src/agent/change-tracker.ts");
  await until(() => document.body.textContent.includes("const source = 'native';"));
  click("Close review panel");
  await until(() => !document.querySelector("aside"));
  dom.window.TurnPreview.fixture.state.failUndo = true;
  click("Undo");
  await until(() => document.body.textContent.includes("Confirm Undo"));
  click("Confirm Undo");
  await until(() => document.body.textContent.includes("later changes"));
  dom.window.TurnPreview.fixture.state.failUndo = false;
  click("Confirm Undo");
  await until(
    () =>
      !document.querySelector('[role="dialog"]') && document.body.textContent.includes("Undone"),
  );
  const disabledUndo = document.querySelector('[aria-label="Undone"]');
  assert.equal(disabledUndo.getAttribute("aria-disabled"), "true");
  assert.equal(disabledUndo.parentElement.title, "This turn's changes are already undone.");
  assert.equal(document.body.textContent.includes("This turn's changes are already undone."), false);
  disabledUndo.click();
  assert.equal(document.querySelector('[role="dialog"]'), null);
  click("Phone width");
  click("Light");
  await until(() => document.body.textContent.includes("Desktop width"));
  const compactPath = document.querySelector('[data-testid="turn-file-path"]');
  compactPath.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  await until(() => document.querySelector('[role="dialog"][aria-label="Full file path"]'));
  compactPath.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, button: 0 }));
  compactPath.click();
  assert.equal(document.querySelector('[aria-label="Turn code changes"]'), null);
  click("Copy path");
  await until(() => document.body.textContent.includes("Path copied"));
  assert.equal(dom.window.TurnPreview.clipboard.text, "/repo/src/agent/change-tracker.ts");
  click("Close popover");
  await until(() => !document.querySelector('[role="dialog"]'));
  click("Review");
  await until(
    () =>
      document.querySelector('[role="dialog"]') &&
      document.body.textContent.includes("const source = 'native';"),
  );
  click("Close popover");
  await until(() => !document.querySelector('[role="dialog"]'));
  click("Change sources");
  await until(() => document.querySelector('select[aria-label="codex"]'));
  assert.equal(document.querySelector('select[aria-label="codex"]').value, "auto");
  assert.equal(document.querySelector('select[aria-label="Other backends"]').value, "edits");
  await until(() => document.body.textContent.includes("no native signal; using plugin records automatically"));
  const select = document.querySelector('select[aria-label="codex"]');
  select.value = "edits";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await until(() => document.body.textContent.includes("Settings saved"));
  assert.equal(dom.window.TurnPreview.fixture.settings().values.providers.codex, "edits");
  click("Remove codex override");
  await until(() => !document.querySelector('select[aria-label="codex"]'));
  assert.equal(
    Object.hasOwn(dom.window.TurnPreview.fixture.settings().values.providers, "codex"),
    false,
  );
  const evidence = {
    runtime: "jsdom + React Native Web; simulated host controls and RPC data",
    assertions: [
      "file totals",
      "path hover exposes the absolute path; copy success, failure and retry do not open review",
      "compact long press shows the full path and copies it without triggering review",
      "review file navigation",
      "source button invokes the selected file RPC and clears errors on file change",
      "source editor stays in the review panel; save, conflict draft and return preserve workspace and file selection",
      "directory collapse and expand, path search, empty search and direct file selection",
      "review opens native explorer location with correct workspace and agent",
      "file click updates the existing review selection",
      "original and updated line numbers",
      "colored diff rows omit raw patch headers",
      "disabled undo exposes hover reason without persistent warning or click action",
      "undo conflict message",
      "undo success",
      "compact/light render",
      "compact review opens visible modal",
      "provider settings persisted through RPC",
      "native source availability",
      "remove provider override",
    ],
    realBrowserVerified: false,
  };
  await writeFile(path.join(output, "ui-smoke.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  dom.window.TurnPreview.dispose();
  dom.window.close();
}
