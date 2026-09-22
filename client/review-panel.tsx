import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { getSummary, listChanges } from "../shared/contracts";
import { Review } from "./review";
import { useReviewSelection } from "./review-navigation";
import { Action } from "./card";

export function ReviewPanel(props: PluginAgentPanelProps) {
  const { host, agentId, theme } = props;
  const { navigation, selected } = useReviewSelection(agentId);
  const list = useRpc(listChanges);
  const read = useRpc(getSummary);
  const history = useQuery({
    queryKey: [host.id, "turn-list", agentId],
    queryFn: () => list({ agentId }),
    enabled: !selected,
  });
  const recordId = selected?.recordId ?? history.data?.find((record) => record.files.length)?.id;
  const query = useQuery({
    queryKey: [host.id, "turn", agentId, recordId],
    queryFn: () => read({ agentId, recordId: recordId! }),
    enabled: !!recordId,
  });
  const error = history.error ?? query.error;
  if (error)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ color: theme.colors.statusDanger }}>{error.message}</Text>
        <Action
          theme={theme}
          label="Retry"
          onPress={() => {
            if (recordId) void query.refetch();
            else void history.refetch();
          }}
        />
      </View>
    );
  if (!recordId && history.isSuccess)
    return (
      <Text style={{ padding: 16, color: theme.colors.foregroundMuted }}>
        No file changes to review.
      </Text>
    );
  if (!query.data)
    return (
      <Text style={{ padding: 16, color: theme.colors.foregroundMuted }}>Loading this turn's changes…</Text>
    );
  const index = Math.min(selected?.index ?? 0, Math.max(0, query.data.files.length - 1));
  return (
    <Review
      {...props}
      fill
      summary={query.data}
      recordId={recordId!}
      index={index}
      setIndex={(index) => navigation?.select(agentId, { recordId: recordId!, index })}
    />
  );
}
