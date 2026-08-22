export type DataResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export function unwrapSupabaseResult<T>(result: DataResult<T>, fallback = "The server returned no data."): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error(fallback);
  return result.data;
}

/** Loads every page instead of silently accepting Supabase's row cap. */
export async function collectPaginatedRows<T>(
  loadPage: (from: number, to: number) => Promise<DataResult<T[]>>,
  pageSize = 1_000,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer.");

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = unwrapSupabaseResult(await loadPage(from, from + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
