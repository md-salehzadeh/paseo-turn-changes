import path from "node:path";
import { parsePatch } from "diff";
import { editsFromItems, patchCounts, recordedEdits } from "./differences";
import type { Record } from "./store";

export function reviewFile(file: Record["files"][number]): Record["files"][number] {
  const complete = !file.issue || file.before !== null || file.after !== null;
  let additions = file.additions;
  let deletions = file.deletions;
  if (file.patch && (additions === null || deletions === null)) {
    try {
      const patches = parsePatch(file.patch);
      if (patches.length) {
        const counts = patches.map(patchCounts);
        additions = counts.reduce((sum, count) => sum + count.additions, 0);
        deletions = counts.reduce((sum, count) => sum + count.deletions, 0);
      }
    } catch {
      /* Keep unavailable counts for malformed historical records. */
    }
  }
  const reviewKind = file.patch
    ? complete
      ? "net"
      : "edits"
    : file.content !== undefined
      ? "content"
      : "unavailable";
  let issue = file.issue;
  if (issue && reviewKind !== "unavailable") {
    if (issue === "The file is outside the current working directory.") issue = "File outside the working directory; view only, automatic undo unavailable.";
    else if (issue === "The file content does not match the edit record and cannot be restored exactly.")
      issue = "The file changed after the edit (e.g. formatting); below are the recorded edits, and automatic undo is unavailable.";
    else if (!issue.includes("undo")) issue += " Automatic undo is unavailable.";
  }
  return { ...file, additions, deletions, reviewKind, issue };
}

// Append only paths newly recovered from a verified call, not net-zero files omitted at capture.
export function reviewRecord(
  record: Record,
  items: readonly unknown[] = [],
  originalItems: readonly unknown[] = items,
): Record {
  const edits = editsFromItems(items);
  const relative = (filePath: string) =>
    path.relative(record.cwd, path.resolve(record.cwd, filePath));
  const moves = new Map(
    edits.flatMap((edit) => {
      if (edit.kind !== "patch") return [];
      const old = edit.patch.oldFileName;
      const next = edit.patch.newFileName;
      return old &&
        next &&
        old !== "/dev/null" &&
        next !== "/dev/null" &&
        relative(old) !== relative(next)
        ? [[relative(old), relative(next)] as const]
        : [];
    }),
  );
  // Correct historical rows in place so their selected file indices continue to resolve correctly.
  const files = record.files.map((file) => {
    const destination = moves.get(file.path);
    return destination
      ? {
          ...file,
          path: destination,
          previousPath: file.path,
          patch: "",
          additions: null,
          deletions: null,
          before: null,
          after: null,
          issue: "Automatic undo is not supported for renames.",
        }
      : file;
  });
  const knownPaths = new Set([
    ...files.map((file) => file.path),
    ...editsFromItems(originalItems).map((edit) => relative(edit.path)),
  ]);
  for (const edit of edits) {
    const filePath = relative(edit.path);
    if (knownPaths.has(filePath)) continue;
    knownPaths.add(filePath);
    files.push({
      path: filePath,
      previousPath:
        edit.kind === "patch" && moves.get(relative(edit.patch.oldFileName ?? "")) === filePath
          ? relative(edit.patch.oldFileName!)
          : null,
      additions: null,
      deletions: null,
      patch: "",
      before: null,
      after: null,
      issue: "File recovered from this turn's tool record; automatic undo is unavailable.",
    });
  }
  return {
    ...record,
    canUndo: record.canUndo && moves.size === 0 && files.length === record.files.length,
    files: files.map((file) => {
      const matching = edits.filter((edit) => relative(edit.path) === file.path);
      const recovered = recordedEdits(file.path, matching);
      const result = reviewFile({
        ...file,
        patch: file.patch || recovered.patch,
        ...(file.content === undefined && recovered.content !== undefined
          ? { content: recovered.content }
          : {}),
      });
      if (record.source === "native" && result.patch) result.reviewKind = "net";
      return result;
    }),
  };
}
