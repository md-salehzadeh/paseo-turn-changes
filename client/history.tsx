import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { listChanges } from "../shared/contracts";
import { Action, RecordCard } from "./card";

export function History(props: PluginAgentPanelProps) {
  const { theme, host, agentId } = props;
  const list = useRpc(listChanges);
  const query = useQuery({
    queryKey: [host.id, "turn-list", agentId],
    queryFn: () => list({ agentId }),
  });
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: props.layout.compact ? 12 : 24 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "600" }}>
          Turn Changes
        </Text>
        <Action theme={theme} label="Refresh" onPress={() => void query.refetch()} />
      </View>
      {query.isPending && (
        <Text style={{ color: theme.colors.foregroundMuted, paddingVertical: 16 }}>
          Loading history…
        </Text>
      )}
      {query.isError && (
        <Text style={{ color: theme.colors.statusDanger, paddingVertical: 16 }}>
          {query.error.message}
        </Text>
      )}
      {query.data?.length === 0 && (
        <Text style={{ color: theme.colors.foregroundMuted, paddingVertical: 16 }}>
          No change records yet. The plugin records new turns after it is enabled.
        </Text>
      )}
      {query.data?.map((summary) => (
        <View key={summary.id}>
          <Text style={{ color: theme.colors.foregroundMuted, paddingTop: 16 }}>
            {new Date(summary.startedAt).toLocaleString()}
          </Text>
          <RecordCard {...props} recordId={summary.id} />
        </View>
      ))}
    </ScrollView>
  );
}
