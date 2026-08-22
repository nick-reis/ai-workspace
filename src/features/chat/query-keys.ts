export const chatKeys = {
  conversations: ["chat", "conversations"] as const,
  allMessages: ["chat", "messages"] as const,
  messages: (id: string | null) => ["chat", "messages", id ?? "new"] as const,
};
