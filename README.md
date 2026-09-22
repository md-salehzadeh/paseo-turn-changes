# Turn Changes

A Paseo plugin that summarizes file changes per agent turn. After a reply it shows the file count, added and deleted lines, and the file list; clicking a file or **Review** opens that turn's diff, and **Undo** restores the files to their content before the turn.

> English translation of [Laokashouji/paseo-turn-changes](https://github.com/Laokashouji/paseo-turn-changes) (Apache-2.0). Only UI strings and documentation were translated; behaviour is unchanged.

## Preview

The screenshots use the real plugin components with simulated file data; the review panel frame is a test host and contains no real project content. They were captured from the upstream Chinese UI — this fork renders the same layout with English text.

![Turn changes card, simulated data](images/01-turn-card.png)

![File diff and file tree, simulated data](images/02-diff-review.png)

## Install

Requires the Paseo client and daemon on `0.8.x` stable with plugins enabled on the target host. From a Paseo CLI connected to that host:

```sh
paseo plugin add md-salehzadeh/paseo-turn-changes
```

The default configuration works on official Paseo with no host patch: Codex prefers the native turn diff and falls back to aggregating file edit records; other execution backends aggregate file edit records by default. Dependencies are prepared from the lock file at install time and need no npm publish.

Update an installed Git-source plugin:

```sh
paseo plugin update turn-changes
```

## Limitations

- The plugin interface is limited to `>=0.8.0 <0.9.0`; Codex native diffs need the optional host patch described below, and the default auto mode needs no patch.
- Pure plugin mode depends on structured file edit records and cannot fully track files written directly by shell commands.
- Automatic undo is unavailable when records are incomplete, files are outside the working directory, or files have later changes; whatever edit content is available can still be reviewed.
- This fork's UI is English. Web desktop and narrow layouts are validated; native Android and iOS clients are not.
- Diff records contain file contents and live on the host running the plugin; history is not auto-cleaned, and it survives uninstall.

## Status

- Verified on an isolated Paseo `0.8.0` stable daemon: plugin install, both sources, consecutive turns, history persistence, and undo. A source tree with only production dependencies installed passes the same verification.
- Codex defaults to automatic source selection: the native cumulative diff is used when this turn carries a native interface signal, otherwise structured edit records are aggregated. Other execution backends default to the plugin aggregating structured edit records.
- The native path needs this repository's host patch; auto mode and the pure plugin path work on official Paseo 0.8.
- Real Claude sessions verified file statistics, diff cards, later-change protection, and undo.
- The Codex native path passed real file-edit tests, scripted event integration tests, and 153 host integration tests; the unpatched stable release was also verified to have Codex automatically use plugin aggregation, review, and undo. The host patch has been submitted as [official PR #4700](https://github.com/getpaseo/paseo/pull/4700); upstream merge status is authoritative.
- The real Paseo web client verified the settings page, history cards, file review, and the 390px narrow-layout popover with data from real Claude edit records. Component interaction regression also uses React Native Web and jsdom; narrow web validation is not the same as Android or iOS native client validation.

## Surfaces

After a turn with changes finishes, a card reading "Edited N files" is added to the conversation. No empty card is inserted when there are no changes and no errors. The file list shows the first six entries by default and can be expanded. A history card's diff is stored at generation time and does not change with later edits or Git commits.

- Clicking a file or **Review** opens the diff in Paseo's native right-hand panel, where you can switch to the previous and next file. Additions and deletions use full-line red/green backgrounds, matching line numbers, and a thin left bar; code uses Paseo's syntax highlighting library. Lines the patch does not include are shown only as an omission count. The left conversation stays visible; the width is managed by Paseo and can be dragged (320px by default on 0.8.0, and the plugin's public interface cannot set an initial width). Narrow screens or a missing workspace context use the native popover; the 0.8.0 Explorer open interface does not expand the narrow-screen drawer.
- Clicking **Undo** undoes the whole turn after a second confirmation. If any file has later changes, the whole turn refuses to undo.
- Card paths keep the file name first and elide the middle of long directories. Hovering on desktop shows the full absolute path, and the adjacent copy button copies the original path; long-pressing on mobile opens the full path with copy actions. The pre-rename path uses the same interaction.
- Reasons an undo is unavailable are shown only when hovering the greyed-out undo button; they are not permanently shown on the card, file list, or review body. Web and desktop use the browser's native tooltip, and native mobile clients read the reason through the accessibility hint.
- Once the review panel reaches 680px, the selected file's diff appears on the left and this turn's changed-file tree on the right. Directory collapse, filtering by file name or full path, and a selected-file background are supported; the file name and added/deleted statistics are shown together. Clicking **Files** at the top collapses the list. Narrow sidebars and phones switch to the list via **Files** and return to the diff after selecting. The list comes from this turn's record and does not scan the working directory.
- **Open source file** at the right of the file title shows a text editor in the same review sidebar, supporting save and return to the diff without opening a window or creating a workspace. Saving checks the file version read earlier and keeps the draft on conflict; returning to the diff warns about unsaved changes. An archived and deleted Paseo worktree opens the current file mapped through the retained main repository, and the actual path is shown above the editor. Only UTF-8 text up to 1 MiB is supported; a missing file is neither restored nor created.
- Codex plugin aggregation backfills added files and same-call multi-file diffs from the local Codex log, keyed by session id and completed tool-call id. Custom backends are recognized via Paseo's `extends` configuration, and the log directory follows that backend's inherited and overridden `CODEX_HOME`. When the log is missing, existing records are kept; line counts are not inferred from bodies without clear addition evidence. Reviewing an old record also backfills files missed by the same call while keeping the original file order, and still does not offer undo.
- The workspace **Turn Changes** panel shows the current agent's history.
- Command Center: **View Turn Changes** and **Configure Change Source**.
- Settings → Plugins → `turn-changes` → Change source: set the source per execution backend.

Paseo 0.8.0 does not restore the conversation card when an archived session is reopened: the host does not persist messages appended by plugins, and the rebuilt model history does not contain the card. Diff records are stored independently by this plugin and can still be opened from Command Center's **View Turn Changes** history panel; do not treat plugin record persistence and conversation card persistence as the same capability.

`npm run test:ui` generates `tmp/preview.html`, which can be opened directly in a browser. The preview uses real plugin components, simulated data, and simplified host popovers and settings controls; it is not a substitute for acceptance in a real Paseo client.

## Configuration

Defaults:

```json
{
  "defaultSource": "edits",
  "providers": { "codex": "auto" }
}
```

`auto` selects automatically, `native` pins the native turn diff, and `edits` pins plugin aggregation. Matching is by provider ID, not model name. Custom Codex provider IDs can be added individually in settings.

Settings take effect from the next turn; historical records keep their original source. Clients of the same daemon read the same configuration; saving with an old revision is rejected and can be retried after refreshing. An existing explicit `native` configuration stays pinned — choose "Auto (prefer native)" to enable automatic detection.

Auto mode decides from whether this turn's end event carries `nativeDiff`; it does not rely on version numbers or the previous turn's cache. A missing field uses plugin aggregation; a `null` or empty string means the interface is connected but there is no diff, and does not switch the source. The card does not show a source note, and file paths are always shown as absolute paths on the host where the change happened. Automatic selection itself is not a record issue; incomplete history pagination or files that cannot be reconstructed still restrict undo.

The settings page shows whether the configured native source received an interface signal in the latest turn and when it was checked, and can refresh on demand. It is the latest observation; it shows "not confirmed yet" until a turn has completed after installation. Removing a backend's individual configuration makes that backend use the **Other backends** setting.

## Collection scope and undo

The Codex integration layer keeps only the latest `turn/diff/updated` of the current turn and passes it to the plugin on completion, failure, or cancellation; it does not insert the diff into the normal message stream repeatedly.

The pure plugin path reads structured file edit records whose final state is `completed` for this turn, applies the turn's operations backwards per file, and computes the net change. Repeated edits to the same file are merged, and a file restored to its original content is not listed. Uncommitted content that existed before the turn started is not overwritten using a Git baseline.

The following affect completeness:

- Files written directly by a shell command with no structured edit record cannot be discovered by the pure plugin path; it is not equivalent to monitoring the whole directory for changes.
- When a `Write` or edit record lacks the before-content, the replacement cannot be located uniquely, or the record is truncated, automatic undo is unavailable.
- When a display diff with line numbers from a backend such as OMP cannot be parsed, the before/after text in the record is used to compute the diff. A `Write` with only the after-body can be reviewed as content, but whether it created or overwrote a file cannot be determined, and added/deleted line counts are not inferred.
- A Codex `move_path` is shown as a rename: the card and review page show the target and original paths, and **Open source file** opens the target file. A pure rename shows `+0 / -0`; renames do not offer automatic undo. Old cards can also recover the rename relation from the same turn's log.
- Renames, binary files, permission-only changes, symlinks, files outside the working directory, and `.git` internals are not automatically restored for now.
- Ordinary UTF-8 text and Git-escaped CJK paths are supported. A single file snapshot is capped at 2 MiB, with at most 200 files and 24 MiB of snapshots per turn.
- Reloading the plugin restores the persisted turn-start record; when it is missing or history pagination is incomplete, the record is explicitly marked incomplete. Turns before installation are not backfilled.

Diff display does not depend on automatic undo succeeding: when a file was formatted after the edit, is outside the working directory, or cannot be restored, the stored edit record and line counts are still shown. When multiple edits cannot be merged, the review page is labelled "Edit records · line counts are the sum of individual edits" and may contain repeated edits or pre-formatting content. When only after-content exists it is labelled "Content after edits"; unknown before-content is not treated as an empty file and line counts are not fabricated. None of these cases enable automatic undo, and the current file outside the working directory is not read.

Old records restore display statistics from the stored patch; when an old record lacks a body, content provided by the tool is only backfilled when the original conversation's turn, timeline version, and finish sequence match exactly. Reading a review never rewrites history, current files, or undo state. If the original conversation record is no longer available and the plugin did not store content at the time, it cannot be recovered.

Before an undo, all files' content and permissions are checked to confirm they still equal the state at the end of the record; during execution each file is re-checked, and on failure already-written files are restored as far as possible while the error state is kept. Undo is forbidden while an agent is running in the working directory or its parents or children. Undo does not modify the Git index, commits, or branches. The filesystem has no cross-process transactions, so editors or other processes should still avoid writing files concurrently during an undo.

## Storage

Stored by default under `${PASEO_HOME:-~/.paseo}/plugin-data/turn-changes`; `PASEO_TURN_CHANGES_HOME` can point at an isolated directory. Settings and diff records are written with atomic replacement, with file permissions `0600`; records contain before and after text.

The directory belongs to the daemon running the plugin and is not synced across devices. The current version does not auto-clean history; the data directory survives uninstalling the plugin.

## Host patch integration

`patches/codex-turn-diff.patch` contains the Paseo source context and the changes this plugin needs; upstream copyright and licence are retained in [patches/PASEO-LICENSE](patches/PASEO-LICENSE).

The client and daemon must match the Paseo 0.8 plugin interface; the manifest requires `>=0.8.0 <0.9.0` and does not accept 0.7 or 0.8 beta. The patch is based on official `v0.8.0`, commit `b8e24677e12b226c7c38c1c3a40649daa9f1152f`; see [patches/codex-turn-diff.patch](patches/codex-turn-diff.patch). Official 0.8.0 still discards Codex native cumulative diff events; the patch changes server-internal events and plugin server hooks and does not modify the client protocol.

Apply the patch in the corresponding Paseo source root and build:

```sh
git apply --check /absolute/path/paseo-turn-changes/patches/codex-turn-diff.patch
git apply /absolute/path/paseo-turn-changes/patches/codex-turn-diff.patch
npm ci --ignore-scripts --include-workspace-root --workspace=@getpaseo/server --workspace=@getpaseo/cli --workspace=@getpaseo/client --workspace=@getpaseo/protocol --workspace=@getpaseo/plugin --workspace=@getpaseo/relay --workspace=@getpaseo/highlight
npm run build:server
```

The above only builds; it does not replace or restart the current daemon. Switching the running version depends on how Paseo is installed on the target machine; schedule a window first if there are active sessions. Desktop and web clients must also match the version.

On a target daemon already running a compatible version:

```sh
cd /absolute/path/paseo-turn-changes
npm ci --omit=dev --ignore-scripts
paseo plugin install /absolute/path/paseo-turn-changes
```

Plugins must already be enabled on the target daemon, and the CLI must point at the correct host. Install and configure on each machine separately.

When installing from Git, the build command in the manifest installs the pinned production dependencies. For development checks, run `npm ci --ignore-scripts` without `--omit=dev`.

## Development verification

```sh
npm run typecheck
npm run lint -- client server shared index.client.tsx index.server.ts
npm test
npm run test:ui
npx tsx tests/daemon-smoke.mjs /absolute/path/paseo-turn-diff-host
```

Integration tests use random ports, isolated storage, and a scripted test backend; they do not touch the main daemon, real models, or real working files, and they shut down temporary services and clean up directories afterwards. Receipts are written to `tmp/daemon-smoke.json` and `tmp/ui-smoke.json`.

`PASEO_TEST_PLUGIN_ROOT` can point at a plugin copy with only production dependencies installed, to verify module resolution as it happens in a real installation.

The Paseo patch tests run under its `packages/server`:

```sh
npx vitest run src/server/agent/providers/codex-app-server-agent.test.ts --bail=1
```

## Licence

This plugin is licensed under [Apache-2.0](LICENSE). Upstream copyright and licence for the Paseo integration patch are retained in [patches/PASEO-LICENSE](patches/PASEO-LICENSE).
