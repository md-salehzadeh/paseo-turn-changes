import type { PluginClientContext } from "@getpaseo/plugin/client";
import { cardSchema } from "./shared/contracts";
import { TurnCard } from "./client/card";
import { SourcesSettings } from "./client/settings";
import { History } from "./client/history";
import { ReviewPanel } from "./client/review-panel";
import { createReviewNavigation, ReviewNavigation } from "./client/review-navigation";

export default function contribute(client: PluginClientContext) {
  const navigation = createReviewNavigation((id, options) => client.openPanel(id, options));
  client.addTimelineRenderer({
    kind: "turn-changes",
    version: 1,
    schema: cardSchema,
    Component: (props) => (
      <ReviewNavigation.Provider value={navigation}>
        <TurnCard {...props} />
      </ReviewNavigation.Provider>
    ),
  });
  client.addSettingsScreen({
    id: "sources",
    title: "Change source",
    icon: "SlidersHorizontal",
    Component: SourcesSettings,
  });
  client.addWorkspacePanel({
    id: "history",
    title: "Turn Changes",
    icon: "FileDiff",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: (props) => (
      <ReviewNavigation.Provider value={navigation}>
        <History {...props} />
      </ReviewNavigation.Provider>
    ),
  });
  client.addWorkspacePanel({
    id: "review",
    title: "Turn code changes",
    icon: "FileDiff",
    context: "agent",
    locations: ["explorer"],
    Component: (props) => (
      <ReviewNavigation.Provider value={navigation}>
        <ReviewPanel {...props} />
      </ReviewNavigation.Provider>
    ),
  });
  client.addCommandCenterItem({
    id: "history",
    title: "View Turn Changes",
    icon: "FileDiff",
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("history");
    },
  });
  client.addCommandCenterItem({
    id: "sources",
    title: "Configure Change Source",
    icon: "Settings",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("sources");
    },
  });
  return () => {};
}
