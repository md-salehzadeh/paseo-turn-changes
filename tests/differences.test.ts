import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTwoFilesPatch } from "diff";
import { nativeFiles, parseDiff, reconstruct } from "../server/differences";

test("Repeated edits merge into the final net change, keeping uncommitted content from before the turn", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    const before = "user's uncommitted change\nold\n";
    const middle = "user's uncommitted change\nmiddle\n";
    const after = "user's uncommitted change\nfinal\n";
    await writeFile(path.join(cwd, "a.txt"), after);
    const changes = [
      ...parseDiff(createTwoFilesPatch("a.txt", "a.txt", before, middle)),
      ...parseDiff(createTwoFilesPatch("a.txt", "a.txt", middle, after)),
    ];
    const [file] = await reconstruct(cwd, changes);
    assert.equal(file.issue, null);
    assert.equal(file.before?.text, before);
    assert.equal(file.after?.text, after);
    assert.equal(file.additions, 1);
    assert.equal(file.deletions, 1);
    assert.equal(file.patch.includes("middle"), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Added, deleted, and reverted to original", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    await writeFile(path.join(cwd, "added.txt"), "new\n");
    await writeFile(path.join(cwd, "same.txt"), "old\n");
    const changes = [
      ...parseDiff(createTwoFilesPatch("/dev/null", "added.txt", "", "new\n")),
      ...parseDiff(
        `diff --git a/deleted.txt b/deleted.txt\ndeleted file mode 100644\n${createTwoFilesPatch("a/deleted.txt", "/dev/null", "deleted\n", "")}`,
      ),
      ...parseDiff(createTwoFilesPatch("same.txt", "same.txt", "old\n", "middle\n")),
      ...parseDiff(createTwoFilesPatch("same.txt", "same.txt", "middle\n", "old\n")),
    ];
    const files = await reconstruct(cwd, changes);
    assert.deepEqual(
      files.map((file) => [file.path, file.additions, file.deletions, file.issue]),
      [
        ["added.txt", 1, 0, null],
        ["deleted.txt", 0, 1, null],
      ],
    );
    assert.equal(files[0].before, null);
    assert.equal(files[1].after, null);
    assert.equal(files[1].before?.text, "deleted\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("A file modified again or an out-of-bounds path is marked unrestorable", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    await writeFile(path.join(cwd, "a.txt"), "external edit\n");
    const [file] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("a.txt", "a.txt", "old\n", "new\n")),
    );
    assert.match(file.issue!, /does not match the edit record/);
    assert.equal(file.additions, null);
    const [outside] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("../outside.txt", "../outside.txt", "old\n", "new\n")),
    );
    assert.match(outside.issue!, /working directory/);
    await symlink("/tmp", path.join(cwd, "link"));
    const [linked] = await reconstruct(
      cwd,
      parseDiff(createTwoFilesPatch("link/a", "link/a", "old\n", "new\n")),
    );
    assert.match(linked.issue!, /symlinks/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Git-escaped CJK paths decode to real file names and keep native diff evidence", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    const diff =
      'diff --git "a/\\346\\226\\207.txt" "b/\\346\\226\\207.txt"\n--- "a/\\346\\226\\207.txt"\n+++ "b/\\346\\226\\207.txt"\n@@ -1 +1 @@\n-old\n+new\n';
    await writeFile(path.join(cwd, "文.txt"), "new\n");
    const [file] = await nativeFiles(cwd, diff);
    assert.equal(file.path, "文.txt");
    assert.equal(file.before?.text, "old\n");
    assert.equal(file.issue, null);
    await writeFile(path.join(cwd, "文.txt"), "later\n");
    const [changed] = await nativeFiles(cwd, diff);
    assert.match(changed.issue!, /does not match the edit record/);
    assert.deepEqual([changed.additions, changed.deletions], [1, 1]);
    assert.match(changed.patch, /-old\n\+new/);
    assert.equal(changed.before, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("UTF-8 BOM and original file permissions survive restore", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "turn-diff-"));
  try {
    const before = "\ufeffold\n";
    const after = "\ufeffnew\n";
    await writeFile(path.join(cwd, "script"), after, { mode: 0o644 });
    const diff = `diff --git a/script b/script\nold mode 100755\nnew mode 100644\n${createTwoFilesPatch("a/script", "b/script", before, after)}`;
    const [file] = await nativeFiles(cwd, diff);
    assert.equal(file.before?.text, before);
    assert.equal(file.after?.text, after);
    assert.equal(file.before?.mode, 0o755);
    assert.equal(file.after?.mode, 0o644);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
