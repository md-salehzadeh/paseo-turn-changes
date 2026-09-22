import { readFile, realpath, stat, open, lstat, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { isMissing } from "./store";
import type { SourceDocument } from "../shared/contracts";

const workspaceSchema = z.object({
  cwd: z.string(),
  mainRepoRoot: z.string().nullable().optional(),
  isPaseoOwnedWorktree: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
});
function contains(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function existingFile(target: string) {
  try {
    if (!(await stat(target)).isFile()) throw new Error("The source path is not a file.");
    return await realpath(target);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function resolveSource(cwd: string, name: string, paseoHome: string) {
  const original = path.resolve(cwd, name);
  if (original.split(path.sep).includes(".git")) throw new Error("Git internals are not opened.");
  let absolutePath = await existingFile(original);
  let root = cwd;
  if (!absolutePath) {
    // Archived worktree ownership is retained by Paseo after the directory is removed.
    // Only that exact mapping can redirect a historical path to its main checkout.
    let workspaces: z.infer<typeof workspaceSchema>[] = [];
    try {
      const rows: unknown = JSON.parse(
        await readFile(path.join(paseoHome, "projects", "workspaces.json"), "utf8"),
      );
      if (Array.isArray(rows))
        workspaces = rows.flatMap((row) => {
          const parsed = workspaceSchema.safeParse(row);
          return parsed.success ? [parsed.data] : [];
        });
    } catch {
      /* Missing metadata must not guess a repository by file name. */
    }
    const owner = workspaces
      .filter(
        (entry) =>
          entry.isPaseoOwnedWorktree &&
          entry.archivedAt &&
          entry.mainRepoRoot &&
          contains(entry.cwd, original),
      )
      .sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (owner?.mainRepoRoot) {
      root = owner.mainRepoRoot;
      absolutePath = await existingFile(path.resolve(root, path.relative(owner.cwd, original)));
      if (absolutePath && !contains(await realpath(root), absolutePath))
        throw new Error("The source file link points outside the main repository.");
    }
  }
  if (!absolutePath) throw new Error("The source file was deleted or moved; no actual file to open was found.");
  try {
    root = await realpath(root);
  } catch {
    root = path.dirname(absolutePath);
  }
  if (!contains(root, absolutePath)) root = path.dirname(absolutePath);
  return { cwd: root, path: path.relative(root, absolutePath), absolutePath };
}

const MAX_SOURCE_BYTES = 1024 * 1024;
const conflict = "The source file changed or moved elsewhere; not saved. Your draft was kept — reopen the file to reconcile.";
function version(info: Awaited<ReturnType<FileHandle["stat"]>>, bytes: Buffer) {
  return createHash("sha256")
    .update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:`)
    .update(bytes)
    .digest("hex");
}
async function readHandle(handle: FileHandle) {
  const info = await handle.stat();
  if (!info.isFile()) throw new Error("The source path is not a regular file.");
  if (info.size > MAX_SOURCE_BYTES) throw new Error("The file exceeds 1 MiB; side-panel editing is not supported.");
  const bytes = Buffer.alloc(MAX_SOURCE_BYTES + 1);
  let size = 0;
  while (size < bytes.length) {
    const read = await handle.read(bytes, size, bytes.length - size, size);
    if (read.bytesRead === 0) break;
    size += read.bytesRead;
  }
  if (size > MAX_SOURCE_BYTES) throw new Error("The file exceeds 1 MiB; side-panel editing is not supported.");
  const content = bytes.subarray(0, size);
  if (content.includes(0)) throw new Error("Binary files cannot be edited in the side panel.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    throw new Error("The file is not UTF-8 text; side-panel editing is not supported.");
  }
  const after = await handle.stat();
  if (info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs || info.size !== after.size)
    throw new Error(conflict);
  return { content: text, revision: version(after, content), info: after };
}
export async function readSource(source: {
  path: string;
  absolutePath: string;
}): Promise<SourceDocument> {
  const handle = await open(
    source.absolutePath,
    constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const value = await readHandle(handle);
    return {
      path: source.path,
      absolutePath: source.absolutePath,
      content: value.content,
      revision: value.revision,
    };
  } finally {
    await handle.close();
  }
}
export async function writeSource(
  source: { path: string; absolutePath: string },
  input: { absolutePath: string; revision: string; content: string },
): Promise<SourceDocument> {
  if (source.absolutePath !== input.absolutePath) throw new Error(conflict);
  const bytes = Buffer.from(input.content);
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error("The file exceeds 1 MiB; not saved.");
  if (bytes.includes(0)) throw new Error("The content contains binary characters; not saved.");
  // Open without truncation; compare the exact file and version before writing.
  const handle = await open(
    source.absolutePath,
    constants.O_RDWR | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const current = await readHandle(handle);
    const atPath = await lstat(source.absolutePath);
    if (
      current.revision !== input.revision ||
      atPath.ino !== current.info.ino ||
      atPath.dev !== current.info.dev ||
      atPath.mtimeMs !== current.info.mtimeMs ||
      atPath.ctimeMs !== current.info.ctimeMs
    )
      throw new Error(conflict);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (!written.bytesWritten) throw new Error("The file write was interrupted; verify the source file.");
      offset += written.bytesWritten;
    }
    await handle.truncate(bytes.length);
    await handle.sync();
    const saved = await readHandle(handle);
    return {
      path: source.path,
      absolutePath: source.absolutePath,
      content: saved.content,
      revision: saved.revision,
    };
  } finally {
    await handle.close();
  }
}
