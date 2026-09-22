import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isMissing, type Snapshot } from "./store";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function checkedPath(cwd: string, name: string): Promise<string> {
  const root = await realpath(cwd);
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("The file is outside the current working directory.");
  }
  const parts = relative.split(path.sep);
  if (parts.includes(".git")) throw new Error("Git internals are not processed.");
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error("Symlinks are not processed.");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return target;
}

export async function snapshot(cwd: string, name: string): Promise<Snapshot | null> {
  const target = await checkedPath(cwd, name);
  try {
    const stat = await lstat(target);
    if (!stat.isFile()) throw new Error("Only regular text files are supported.");
    if (stat.size > MAX_FILE_BYTES) throw new Error("The file exceeds 2 MiB; no undo snapshot was saved.");
    const bytes = await readFile(target);
    if (bytes.includes(0)) throw new Error("Binary files do not support text diffs.");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, mode: stat.mode & 0o777 };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export function sameSnapshot(left: Snapshot | null, right: Snapshot | null): boolean {
  if (left === null || right === null) return left === right;
  return left.text === right.text && left.mode === right.mode;
}
