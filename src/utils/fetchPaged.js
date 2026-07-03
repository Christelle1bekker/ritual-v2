// Supabase/PostgREST silently caps un-ranged selects at 1000 rows. Any query
// that can grow past that (e.g. completions over a 120-day window for a
// multi-member family) must paginate or streaks/stats are computed on a
// truncated, arbitrarily-ordered subset.
//
// buildQuery must return a FRESH query builder on every call (PostgREST
// builders are single-use) and must apply a deterministic .order() — without
// one, rows can shift between pages and be duplicated or skipped.
export async function fetchAllPages(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
