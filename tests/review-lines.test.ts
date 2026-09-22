import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewLines } from "../client/review-lines";
import { undoHint } from "../shared/undo-hint";
import { createFixture } from "./ui/fixture";
import type { Summary } from "../shared/contracts";

test("Diffs keep line numbers and code, strip patch headers, and highlight before/after separately", () => {
  const lines = reviewLines(
    "Index: a.ts\n===\n--- a.ts\n+++ a.ts\n@@ -34,3 +34,3 @@\n // 中文\n-const before = 1;\n+const after = 2;\n \n",
    undefined,
    "a.ts",
  );
  assert.equal(lines[0].text, "Omitted 33 lines");
  assert.equal(
    lines.some((line) => line.text.startsWith("Index:")),
    false,
  );
  const deleted = lines.find((line) => line.kind === "delete")!;
  const added = lines.find((line) => line.kind === "add")!;
  assert.equal(deleted.oldLine, 35);
  assert.equal(added.newLine, 35);
  for (const line of [deleted, added]) {
    assert.equal(line.tokens?.map((token) => token.text).join(""), line.text);
    assert.ok(line.tokens?.some((token) => token.style === "keyword"));
  }
  assert.equal(lines.at(-1)?.text, "");
});

test("Repeated edits are segmented; context lines and new-content-only files are not marked as added", () => {
  const patch = "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-a\n+b\n";
  const lines = reviewLines(patch + patch, undefined, "a.unknown");
  assert.ok(lines.some((line) => line.text === "Next edit record"));
  assert.equal(lines.filter((line) => line.kind === "add").length, 2);
  const content = reviewLines("", "const a = 1;\n", "a.ts");
  assert.ok(content.every((line) => line.kind === "context" && line.oldLine === null));
  assert.equal(content.map((line) => line.text).join("\n"), "const a = 1;\n");
  assert.deepEqual(reviewLines("", undefined, "a.ts"), []);
});

test("Oversized bodies keep readable content and skip syntax analysis", () => {
  const source = "x".repeat(160_001);
  const lines = reviewLines("", source, "a.ts");
  assert.equal(lines[0].tokens, undefined);
  assert.equal(lines[0].text, source);
});

test("Unrecognized diff formats keep raw text for review", () => {
  const lines = reviewLines("@@\n-before\n+after", undefined, "a.txt");
  assert.equal(lines.map((line) => line.text).join("\n"), "@@\n-before\n+after");
});

test("The disabled-undo hint aggregates and dedupes reasons; no hint when undo is available", async () => {
  const summary = (await createFixture().invoke("changes.read", {})) as Summary;
  assert.equal(undoHint(summary), undefined);
  const reason = "File outside the working directory; view only, automatic undo unavailable.";
  assert.equal(
    undoHint({
      ...summary,
      canUndo: false,
      issues: [reason],
      files: [{ ...summary.files[0], issue: reason }],
    }),
    `Cannot undo:\n${reason}`,
  );
});
