import { useMutation, useQueryClient } from "@tanstack/react-query";

import { graphKeys } from "@/features/graph/query-keys";
import { chatKeys } from "@/features/chat/query-keys";
import { activityKeys, performActivityAction } from "./activity-api";

export function useActivityAction(onError?: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: performActivityAction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      void queryClient.invalidateQueries({ queryKey: graphKeys.workspace });
      void queryClient.invalidateQueries({ queryKey: chatKeys.allMessages });
    },
    onError: (failure) => onError?.(failure instanceof Error ? failure.message : "The activity could not be updated."),
  });
}
