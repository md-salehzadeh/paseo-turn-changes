import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { settingsSchema, sourceFor } from "../shared/contracts";
import { Store } from "../server/store";

test("Codex auto-selects the diff source, other backends aggregate edits, and explicit config overrides defaults", () => {
  const defaults = settingsSchema.parse({});
  assert.equal(sourceFor(defaults, "codex"), "auto");
  assert.equal(sourceFor(defaults, "claude"), "edits");
  assert.equal(sourceFor(defaults, "custom-provider"), "edits");
  assert.equal(sourceFor(defaults, "constructor"), "edits");
  assert.equal(sourceFor({ ...defaults, providers: { codex: "edits" } }, "codex"), "edits");
  assert.equal(
    sourceFor(settingsSchema.parse({ providers: { codex: "native" } }), "codex"),
    "native",
  );
});

test("Settings persist and stale revisions from another client are rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "turn-settings-"));
  try {
    const store = new Store(directory);
    const initial = await store.readSettings();
    const saved = await store.saveSettings(initial.revision, {
      ...initial.values,
      providers: { codex: "edits" },
    });
    assert.deepEqual(await new Store(directory).readSettings(), saved);
    await assert.rejects(store.saveSettings(initial.revision, initial.values), /changed elsewhere/);
    assert.deepEqual(await store.readSettings(), saved);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
