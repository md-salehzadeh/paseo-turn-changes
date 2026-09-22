import assert from "node:assert/strict";
import { test } from "node:test";
import { createTwoFilesPatch } from "diff";
import { codexRecordedItems } from "../server/codex-records";
import { editsFromItems, reconstruct } from "../server/differences";
import { reviewRecord } from "../server/review";
import type { Record } from "../server/store";

const sessionId = "01900000-0000-7000-8000-000000000001";
const oldPath = "/repo/old/Monitor.kt";
const nextPath = "/repo/new/Identifier.kt";
const call = {
  type: "tool_call",
  status: "completed",
  callId: "edit-1",
  detail: { type: "edit", filePath: oldPath, unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n" },
};
function event(diff = call.detail.unifiedDiff) {
  return {
    type: "event_msg",
    payload: {
      type: "item_completed",
      thread_id: sessionId,
      item: {
        type: "FileChange",
        id: call.callId,
        status: "completed",
        changes: {
          [oldPath]: { type: "update", move_path: nextPath, unified_diff: diff },
        },
      },
    },
  };
}
function historical(): Record {
  return {
    cwd: "/repo",
    source: "edits",
    canUndo: false,
    files: [
      {
        path: "old/Monitor.kt",
        previousPath: null,
        patch: createTwoFilesPatch(oldPath, oldPath, "old\n", "new\n"),
        additions: 1,
        deletions: 1,
        before: null,
        after: null,
        issue: "The file's added/deleted state does not match the edit record.",
      },
    ],
  } as Record;
}

test("Codex renames keep both paths, repairing old cards without duplicating files", async () => {
  const original = historical();
  const saved = structuredClone(original);
  const enriched = codexRecordedItems([call], [event()], sessionId, "/repo");
  const shown = reviewRecord(original, enriched, [call]);
  assert.equal(shown.files.length, 1);
  const [file] = shown.files;
  assert.equal(file.path, "new/Identifier.kt");
  assert.equal(file.previousPath, "old/Monitor.kt");
  assert.deepEqual([file.additions, file.deletions], [1, 1]);
  assert.match(file.patch, /\+\+\+ \/repo\/new\/Identifier.kt/);
  assert.equal(shown.canUndo, false);
  assert.equal(file.before, null);
  assert.equal(file.after, null);
  assert.deepEqual(original, saved);
  const captured = await reconstruct("/repo", editsFromItems(enriched));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].path, "new/Identifier.kt");
  assert.equal(captured[0].previousPath, "old/Monitor.kt");
  assert.match(captured[0].issue!, /rename/);
  assert.equal(reviewRecord({ ...original, files: captured }, enriched, [call]).files.length, 1);
});

test("Pure renames with no text change are still recorded, independent of the current file's existence", async () => {
  const enriched = codexRecordedItems([call], [event("")], sessionId, "/repo");
  const files = await reconstruct("/repo", editsFromItems(enriched));
  const shown = reviewRecord({ ...historical(), files });
  assert.equal(shown.files.length, 1);
  assert.equal(shown.files[0].previousPath, "old/Monitor.kt");
  assert.deepEqual([shown.files[0].additions, shown.files[0].deletions], [0, 0]);
});

test("A call spanning multiple files recovers missing renames and keeps original paths", () => {
  const firstPath = "/repo/interface.kt";
  const firstCall = { ...call, detail: { ...call.detail, filePath: firstPath } };
  const native = event();
  const multiFile = {
    ...native,
    payload: {
      ...native.payload,
      item: {
        ...native.payload.item,
        changes: {
          [firstPath]: { type: "update", unified_diff: call.detail.unifiedDiff },
          ...native.payload.item.changes,
        },
      },
    },
  };
  const enriched = codexRecordedItems([firstCall], [multiFile], sessionId, "/repo");
  const original = historical();
  original.files[0] = { ...original.files[0], path: "interface.kt" };
  const shown = reviewRecord(original, enriched, [firstCall]);
  assert.equal(shown.files.length, 2);
  assert.equal(shown.files[0].path, "interface.kt");
  assert.equal(shown.files[1].path, "new/Identifier.kt");
  assert.equal(shown.files[1].previousPath, "old/Monitor.kt");
  assert.deepEqual([shown.files[1].additions, shown.files[1].deletions], [1, 1]);
});

test("Renames do not recover across sessions or failed calls; plain deletions stay deletions", async () => {
  assert.deepEqual(codexRecordedItems([call], [event()], "other", "/repo"), [call]);
  const failed = { ...call, status: "failed" };
  assert.deepEqual(codexRecordedItems([failed], [event()], sessionId, "/repo"), [failed]);
  const deletion = {
    ...event(),
    payload: {
      ...event().payload,
      item: {
        ...event().payload.item,
        changes: { [oldPath]: { type: "delete", content: "old\n" } },
      },
    },
  };
  const enriched = codexRecordedItems([call], [deletion], sessionId, "/repo");
  const captured = await reconstruct("/repo", editsFromItems(enriched));
  const { files } = reviewRecord({ ...historical(), files: captured });
  assert.equal(files[0].path, "old/Monitor.kt");
  assert.equal(files[0].previousPath, null);
  assert.deepEqual([files[0].additions, files[0].deletions], [0, 1]);
});
