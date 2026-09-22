import { randomUUID } from "node:crypto";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { sourceFor } from "../shared/contracts";
import { editsFromItems, message, nativeFiles, reconstruct } from "./differences";
import { Store, type Record } from "./store";

export type TurnStart = PluginLifecycleEvents["agent.turn_started"];
export type TurnEnd = PluginLifecycleEvents["agent.turn_ended"] & { nativeDiff?: string | null };

export class Capture {
  private readonly active = new Map<string, Record>();
  constructor(private readonly store: Store) {}

  async start(event: TurnStart): Promise<void> {
    const { values } = await this.store.exclusive("settings", () => this.store.readSettings());
    const requestedSource = sourceFor(values, event.agent.provider);
    const record: Record = {
      version: 1,
      id: randomUUID(),
      agentId: event.agent.id,
      provider: event.agent.provider,
      cwd: event.agent.cwd,
      turnId: event.turnId,
      source: requestedSource === "edits" ? "edits" : "native",
      requestedSource,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      outcome: "incomplete",
      issues: ["This turn has not finished; if the plugin stopped while recording, re-verification is needed."],
      files: [],
      canUndo: false,
      undoneAt: null,
      undoState: "ready",
    };
    this.active.set(event.agent.id, record);
    await this.store.save(record);
  }

  async finish(
    event: TurnEnd,
    items: readonly unknown[],
    timelineIssue?: string,
    timeline?: Record["timeline"],
  ): Promise<Record> {
    await this.store.observeNative(event.agent.provider, event.nativeDiff !== undefined);
    let initial = this.active.get(event.agent.id);
    let missingStart = false;
    if (!initial || initial.turnId !== event.turnId) {
      initial = (await this.store.list(event.agent.id)).find(
        (record) => !record.finishedAt && record.turnId === event.turnId,
      );
      if (!initial) {
        missingStart = true;
        await this.start(event);
        initial = this.active.get(event.agent.id)!;
      }
    }
    const record: Record = {
      ...initial!,
      finishedAt: new Date().toISOString(),
      outcome: event.outcome.kind,
      issues: [],
      files: [],
      ...(timeline ? { timeline } : {}),
    };
    if (record.requestedSource === "auto") {
      record.source = event.nativeDiff === undefined ? "edits" : "native";
    }
    if (missingStart) record.issues.push("Missing the turn-start record; undo is unavailable.");
    try {
      const edits = editsFromItems(items);
      if (record.source === "native") {
        if (typeof event.nativeDiff === "string") {
          record.files = await nativeFiles(record.cwd, event.nativeDiff);
        } else if (event.nativeDiff === undefined || edits.length || timelineIssue) {
          record.issues.push(
            event.nativeDiff === undefined
              ? "This Paseo is not forwarding the native turn diff. Official 0.8.0 still needs the host patch; the source was not switched automatically."
              : "The execution backend did not provide a turn diff; a complete record cannot be produced.",
          );
        }
      } else {
        if (timelineIssue) record.issues.push(timelineIssue);
        record.files = await reconstruct(record.cwd, edits);
      }
    } catch (error) {
      record.issues.push(message(error));
    }
    const complete =
      record.issues.length === 0 && record.files.every((file) => file.issue === null);
    record.canUndo = complete && record.files.length > 0;
    await this.store.save(record);
    if (this.active.get(event.agent.id)?.id === initial!.id) this.active.delete(event.agent.id);
    return record;
  }
}
