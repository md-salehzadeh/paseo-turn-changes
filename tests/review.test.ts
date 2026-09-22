import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { editsFromItems, parseDiff, reconstruct } from "../server/differences";
import { reviewFile, reviewRecord } from "../server/review";
import type { Record } from "../server/store";

test("Post-formatting records remain reviewable with edit line counts, but no fake undo snapshot is produced", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "review-format-"));
  try {
    await writeFile(path.join(cwd, "a.ts"), 'const x = "new";\n');
    const [file] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("a.ts", "a.ts", "const x='old'\n", "const x='new'\n")),
    );
    const shown = reviewFile(file);
    assert.equal(shown.reviewKind, "edits");
    assert.deepEqual([shown.additions, shown.deletions], [1, 1]);
    assert.match(shown.patch, /-const x='old'\n\+const x='new'/);
    assert.match(shown.issue!, /formatting.*automatic undo is unavailable/);
    assert.equal(shown.before, null);
    assert.equal(shown.after, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("External paths show only the saved diff, with no reads and no undo", async () => {
  const [file] = await reconstruct(
    os.tmpdir(),
    parseDiff(
      createTwoFilesPatch("/outside/not-present.txt", "/outside/not-present.txt", "a\n", "b\n"),
    ),
  );
  const shown = reviewFile(file);
  assert.deepEqual([shown.additions, shown.deletions], [1, 1]);
  assert.match(shown.issue!, /outside the working directory.*automatic undo unavailable/);
  assert.match(shown.patch, /-a\n\+b/);
  assert.equal(shown.before, null);
});

test("With only newString it shows after-content without treating unknown before-content as a new file", async () => {
  const items = [
    {
      type: "tool_call",
      status: "completed",
      detail: { type: "edit", filePath: "/outside/unreadable.txt", newString: "script\n" },
    },
  ];
  const [file] = await reconstruct(os.tmpdir(), editsFromItems(items));
  const shown = reviewFile(file);
  assert.equal(shown.reviewKind, "content");
  assert.equal(shown.content, "script\n");
  assert.equal(shown.patch, "");
  assert.equal(shown.additions, null);
  assert.equal(shown.deletions, null);
});

test("Old records backfill read-only content from raw tool output, keeping history and undo state", async () => {
  const [file] = await reconstruct(os.tmpdir(), [
    { kind: "unknown", path: "/outside/legacy.txt", reason: "missing source text" },
  ]);
  const record = { cwd: os.tmpdir(), files: [file], canUndo: false, source: "edits" } as Record;
  const original = structuredClone(record);
  const shown = reviewRecord(record, [
    {
      type: "tool_call",
      status: "completed",
      detail: { type: "edit", filePath: "/outside/legacy.txt", newString: "saved content\n" },
    },
  ]);
  assert.equal(shown.files[0].reviewKind, "content");
  assert.equal(shown.files[0].content, "saved content\n");
  assert.equal(shown.canUndo, false);
  assert.deepEqual(record, original);
});

test("Multi-edit deletion counts are labeled as edit-record sums, not net change", async () => {
  const changes = [
    ...parseDiff(createTwoFilesPatch("/outside/a", "/outside/a", "old\n", "middle\n")),
    ...parseDiff(createTwoFilesPatch("/outside/a", "/outside/a", "middle\n", "final\n")),
  ];
  const [file] = await reconstruct(os.tmpdir(), changes);
  const shown = reviewFile(file);
  assert.equal(shown.reviewKind, "edits");
  assert.deepEqual([shown.additions, shown.deletions], [2, 2]);
  assert.match(shown.patch, /middle/);
});

test("OMP display diffs do not overwrite before/after text; canceled turns still recover completed edits' line counts", () => {
  const record = {
    cwd: "/repo",
    source: "edits",
    outcome: "canceled",
    canUndo: false,
    files: [
      {
        path: "config.yml",
        previousPath: null,
        patch: "",
        before: null,
        after: null,
        additions: null,
        deletions: null,
        issue: "This change has no text diff; it may be binary, a permission change, or a rename.",
      },
    ],
  } as Record;
  const before = structuredClone(record);
  for (const unifiedDiff of [
    " 1|config:\n-2|  value: old\n+2|  value: new",
    "@@ broken @@\n+new",
  ]) {
    const shown = reviewRecord(record, [
      {
        type: "tool_call",
        status: "completed",
        detail: {
          type: "edit",
          filePath: "/repo/config.yml",
          unifiedDiff,
          oldString: "config:\n  value: old\n",
          newString: "config:\n  value: new\n",
        },
      },
    ]);
    assert.deepEqual([shown.files[0].additions, shown.files[0].deletions], [1, 1]);
    assert.match(shown.files[0].patch, /-  value: old\n\+  value: new/);
    assert.equal(shown.files[0].reviewKind, "edits");
    assert.equal(shown.canUndo, false);
    assert.deepEqual(record, before);
  }
});

test("Write bodies are reviewable without fabricating added lines; unfinished and failed calls are excluded", async () => {
  for (const content of ["first\nsecond\n", ""]) {
    const call = {
      type: "tool_call",
      status: "completed",
      detail: { type: "write", filePath: "/outside/written.txt", content },
    };
    const [file] = await reconstruct(os.tmpdir(), editsFromItems([call]));
    const shown = reviewFile(file);
    assert.equal(shown.reviewKind, "content");
    assert.equal(shown.content, content);
    assert.equal(shown.patch, "");
    assert.equal(shown.additions, null);
    assert.equal(shown.deletions, null);
    for (const status of ["running", "failed", "canceled"])
      assert.deepEqual(editsFromItems([{ ...call, status }]), []);
    const historical = {
      cwd: os.tmpdir(),
      source: "edits",
      canUndo: false,
      files: [{ ...file, content: undefined }],
    } as Record;
    assert.equal(reviewRecord(historical, [call]).files[0].content, content);
  }
});

test("A valid unified diff still wins; display diffs are not treated as patches when before-content is missing", () => {
  const call = {
    type: "tool_call",
    status: "completed",
    detail: {
      type: "edit",
      filePath: "a.txt",
      oldString: "stale",
      newString: "new\n",
      unifiedDiff: createTwoFilesPatch("a.txt", "a.txt", "old\n", "new\n"),
    },
  };
  assert.equal(editsFromItems([call])[0].kind, "patch");
  assert.equal(
    editsFromItems([
      {
        ...call,
        detail: {
          ...call.detail,
          oldString: undefined,
          unifiedDiff: "-1|old\n+1|new",
        },
      },
    ])[0].kind,
    "content",
  );
});
