import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTwoFilesPatch } from "diff";
import { parseDiff, reconstruct } from "../server/differences";
import { Store, type Record } from "../server/store";
import { undo } from "../server/undo";

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-undo-"));
  await writeFile(path.join(cwd, "first.txt"), "new\n");
  await writeFile(path.join(cwd, "second.txt"), "new\n");
  const edits = ["first.txt", "second.txt"].flatMap((name) =>
    parseDiff(createTwoFilesPatch(name, name, "old\n", "new\n")),
  );
  const files = await reconstruct(cwd, edits);
  const store = new Store(path.join(cwd, "records"));
  const record: Record = {
    version: 1,
    id: randomUUID(),
    agentId: "agent",
    provider: "codex",
    source: "native",
    cwd,
    turnId: "turn",
    startedAt: "2026-09-10T00:00:00Z",
    finishedAt: "2026-09-10T00:01:00Z",
    outcome: "completed",
    issues: [],
    files,
    canUndo: true,
    undoneAt: null,
    undoState: "ready",
  };
  await store.save(record);
  return { cwd, store, record };
}

test("Undo restores pre-turn content; repeating it changes nothing", async () => {
  const { cwd, store, record } = await fixture();
  try {
    const result = await undo(store, record.id, "agent");
    assert.equal(result.undoState, "done");
    assert.equal(result.canUndo, false);
    assert.equal(await readFile(path.join(cwd, "first.txt"), "utf8"), "old\n");
    assert.equal(await readFile(path.join(cwd, "second.txt"), "utf8"), "old\n");
    assert.deepEqual(await undo(store, record.id, "agent"), result);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("If any file has later changes the whole turn refuses undo without touching other files", async () => {
  const { cwd, store, record } = await fixture();
  try {
    await writeFile(path.join(cwd, "second.txt"), "user's later change\n");
    await assert.rejects(undo(store, record.id, "agent"), /later changes/);
    assert.equal(await readFile(path.join(cwd, "first.txt"), "utf8"), "new\n");
    assert.equal(await readFile(path.join(cwd, "second.txt"), "utf8"), "user's later change\n");
    assert.equal((await store.get(record.id, "agent")).undoneAt, null);
    await assert.rejects(undo(store, record.id, "other-agent"), /does not belong/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
