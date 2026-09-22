import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export async function turnItems(
  paseo: PluginHandlerContext["paseo"],
  agentId: string,
  turnId: string | null,
  previous?: { epoch: string; maxSeq: number },
): Promise<{ items: unknown[]; timeline: { epoch: string; maxSeq: number } }> {
  if (!turnId) throw new Error("The backend did not provide a turn id; this turn's edits cannot be delimited reliably.");
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ limit: 200, projection: "canonical" });
  const epoch = page.epoch;
  const minimum = previous?.epoch === epoch ? previous.maxSeq : -1;
  const selected: typeof page.entries = [];
  let found = false;
  for (let count = 0; count < 50; count++) {
    if (page.error || page.gap || page.staleCursor || page.epoch !== epoch)
      throw new Error("The conversation record changed or is incomplete; re-verify this turn's changes.");
    let boundary = false;
    for (const entry of [...page.entries].reverse()) {
      if (entry.seqEnd <= minimum) {
        boundary = true;
        break;
      }
      if (entry.turnId === turnId) {
        selected.unshift(entry);
        found = true;
      } else if (found && entry.turnId) {
        boundary = true;
        break;
      }
    }
    if (boundary || !page.hasOlder) {
      if (!found) throw new Error("No complete conversation record was found for this turn.");
      const calls = new Map<string, { seq: number; item: unknown }>();
      for (const entry of selected) {
        if (entry.item.type !== "tool_call") continue;
        const previous = calls.get(entry.item.callId);
        if (!previous || previous.seq <= entry.seqEnd)
          calls.set(entry.item.callId, { seq: entry.seqEnd, item: entry.item });
      }
      const maxSeq = selected.reduce((value, entry) => Math.max(value, entry.seqEnd), 0);
      return {
        items: [...calls.values()].sort((a, b) => a.seq - b.seq).map((value) => value.item),
        timeline: { epoch, maxSeq },
      };
    }
    if (!page.startCursor) throw new Error("The conversation record is missing its pagination position.");
    page = await timeline.refetch({
      limit: 200,
      projection: "canonical",
      direction: "before",
      cursor: page.startCursor,
    });
  }
  throw new Error("This turn's conversation record is too long; no complete edit record was obtained.");
}
