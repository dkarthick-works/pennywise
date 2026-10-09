import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { searchTransactions } from "../../api/ledger";
import { IconSearch, IconX } from "../ui/Icons";
import { TransactionListTable } from "../dashboard/TransactionListTable";

function SearchResults({ query }: { query: string }) {
  const { data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } = useInfiniteQuery({
    queryKey: ["transaction-search", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => searchTransactions(query, signal, pageParam),
    getNextPageParam: (page) => page.has_more ? page.next_cursor ?? undefined : undefined,
    retry: false,
    gcTime: 0,
  });

  if (isPending) return <p role="status" className="muted" style={{ margin: "16px 0 0" }}>Searching transactions…</p>;
  if (isError && !data) return (
    <div style={{ marginTop: 16 }}>
      <p role="alert" style={{ color: "var(--neg)", margin: "0 0 10px" }}>Could not search transactions. Please try again.</p>
      <button type="button" className="btn btn-soft" onClick={() => refetch()}>Retry search</button>
    </div>
  );

  const rows = data?.pages.flatMap((page) => page.items) ?? [];
  if (rows.length === 0) return <p role="status" className="muted" style={{ margin: "16px 0 0" }}>No matching transactions.</p>;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <h3 className="card-h" style={{ margin: 0 }}>Search results</h3>
        <span role="status" className="muted" style={{ fontSize: 12 }}>
          {hasNextPage ? `Showing first ${rows.length} ${rows.length === 1 ? "match" : "matches"}` : `${rows.length} ${rows.length === 1 ? "match" : "matches"}`}
        </span>
      </div>
      <TransactionListTable rows={rows} showYear />
      {hasNextPage && (
        <div style={{ marginTop: 16 }}>
          {isFetchNextPageError && <p role="alert" style={{ color: "var(--neg)", margin: "0 0 10px" }}>Could not load more transactions. Please try again.</p>}
          <button type="button" className="btn btn-soft" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? "Loading more…" : isFetchNextPageError ? "Retry loading more" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

export function TransactionSearch() {
  const [text, setText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const query = text.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(text.trim()), 100);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <section className="card card-pad" aria-label="Transaction search" style={{ minWidth: 0 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="transaction-search">Search transactions</label>
        <div className="input-wrap input-wrap--lead">
          <span className="input-lead"><IconSearch size={18} aria-hidden="true" /></span>
          <input
            id="transaction-search"
            className="input"
            type="search"
            placeholder="Search by transaction name…"
            aria-describedby="transaction-search-hint"
            value={text}
            maxLength={100}
            onChange={(event) => {
              setText(event.target.value);
              setDebouncedQuery("");
            }}
          />
          {text && (
            <button
              type="button"
              className="input-toggle"
              aria-label="Clear transaction search"
              onClick={() => {
                setText("");
                setDebouncedQuery("");
                document.getElementById("transaction-search")?.focus();
              }}
              style={{ width: 40, height: 40, right: 3, padding: 0, justifyContent: "center" }}
            >
              <IconX size={17} aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="transaction-search-hint" className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>Across all months</p>
      </div>
      {query && (
        query === debouncedQuery
          ? <SearchResults key={query} query={query} />
          : <p role="status" className="muted" style={{ margin: "16px 0 0" }}>Searching transactions…</p>
      )}
    </section>
  );
}
