import type { Summary } from "./contracts";

export function undoHint(summary: Summary): string | undefined {
  if (summary.canUndo) return undefined;
  if (summary.undoneAt) return "This turn's changes are already undone.";
  if (!summary.finishedAt) return "This turn is still running; undo is available after it ends.";
  const reasons = [
    ...new Set([...summary.issues, ...summary.files.map((file) => file.issue)]),
  ].filter((reason): reason is string => Boolean(reason));
  return reasons.length
    ? `Cannot undo:\n${reasons.join("\n")}`
    : summary.files.length
      ? "Missing complete before/after snapshots; automatic undo is unavailable."
      : "This turn has no file changes to undo.";
}
