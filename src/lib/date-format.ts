export function formatDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function relativeTime(value: string, now = Date.now()) {
  const elapsed = now - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Recently";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : formatDate(value);
}
