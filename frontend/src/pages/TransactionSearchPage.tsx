import { TransactionSearch } from "../components/search/TransactionSearch";

export function TransactionSearchPage() {
  return (
    <div className="content fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="page-sub">Find transactions across all months.</p>
        </div>
      </div>
      <TransactionSearch />
    </div>
  );
}
