export function normalizeConversationTitle(value: unknown, fallback: string) {
  const normalized = String(value ?? "")
    .replace(/^[\s#*`"'“”‘’]+|[\s#*`"'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?:;,\-–—]+$/g, "")
    .trim();

  const fallbackTitle = String(fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "New conversation";

  if (!normalized || /^(?:new |untitled )?(?:chat|conversation)$/i.test(normalized)) {
    return fallbackTitle;
  }
  return normalized.slice(0, 80).trim();
}
