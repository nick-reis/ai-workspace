export function takeStreamRevealChunk(value: string, targetLength = 10) {
  if (value.length <= targetLength) return { chunk: value, remainder: "" };
  const searchWindow = value.slice(targetLength, targetLength + 10);
  const boundary = searchWindow.search(/[\s.,!?;:]/);
  const end = boundary >= 0 ? targetLength + boundary + 1 : targetLength;
  return { chunk: value.slice(0, end), remainder: value.slice(end) };
}

export function mergeStreamMessages<T extends { id: string; sequence: number }>(current: T[] | undefined, incoming: T[]) {
  const byId = new Map((current ?? []).map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}
