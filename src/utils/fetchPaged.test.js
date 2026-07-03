import { fetchAllPages } from './fetchPaged';

// Simulates PostgREST: .range(from, to) slices an ordered dataset.
function fakeSupabase(dataset, { failOnPage = null } = {}) {
  let call = 0;
  const buildQuery = jest.fn(() => ({
    range: (from, to) => {
      const page = call++;
      if (failOnPage === page) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: dataset.slice(from, to + 1), error: null });
    },
  }));
  return buildQuery;
}

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe('fetchAllPages', () => {
  it('returns all rows when under one page', async () => {
    const rows = await fetchAllPages(fakeSupabase(makeRows(3)), 1000);
    expect(rows).toHaveLength(3);
  });

  it('fetches past the 1000-row page boundary (the Supabase default cap)', async () => {
    const rows = await fetchAllPages(fakeSupabase(makeRows(2500)), 1000);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toEqual({ id: 2499 });
  });

  it('stops after a page that is exactly full then empty', async () => {
    const buildQuery = fakeSupabase(makeRows(2000));
    const rows = await fetchAllPages(buildQuery, 1000);
    expect(rows).toHaveLength(2000);
    expect(buildQuery).toHaveBeenCalledTimes(3); // 1000 + 1000 + 0
  });

  it('builds a fresh query per page (PostgREST builders are single-use)', async () => {
    const buildQuery = fakeSupabase(makeRows(1500));
    await fetchAllPages(buildQuery, 1000);
    expect(buildQuery).toHaveBeenCalledTimes(2);
  });

  it('throws on error instead of returning a truncated result', async () => {
    await expect(
      fetchAllPages(fakeSupabase(makeRows(2500), { failOnPage: 1 }), 1000)
    ).rejects.toEqual({ message: 'boom' });
  });

  it('returns empty array for empty result', async () => {
    const rows = await fetchAllPages(fakeSupabase([]), 1000);
    expect(rows).toEqual([]);
  });
});
