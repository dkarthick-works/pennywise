import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { ADMIN_PAGE_SIZE, listAdminUsers } from "../api/admin";
import { useAuth } from "../auth/AuthContext";
import type { AdminUser } from "../types";
import "./admin.css";

function errorStatus(error: unknown) {
  return isAxiosError(error) ? error.response?.status : undefined;
}

function userLabels(user: AdminUser) {
  const primary = user.display_name || user.email || user.user_id;
  const secondary = user.display_name && user.email ? user.email : "";
  return { primary, secondary };
}

const joinedDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

export function AdminPage() {
  const { profile, setProfile } = useAuth();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);

  const { data, error, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin", "users", offset],
    queryFn: () => listAdminUsers(offset),
    placeholderData: keepPreviousData,
    // Cross-user data should not outlive this page or survive a revocation.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const status = errorStatus(error);

  useEffect(() => {
    if (status !== 403 || !profile) return;
    qc.removeQueries({ queryKey: ["admin"] });
    setProfile({ ...profile, is_admin: false });
  }, [status, profile, qc, setProfile]);

  if (status === 403) return null;

  const total = data?.total_users ?? 0;
  const rows = data?.users ?? [];
  const first = rows.length ? offset + 1 : 0;
  const last = offset + rows.length;

  return (
    <div className="content fade-in" data-testid="admin-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-sub">Users and recorded activity across Pennywise.</p>
        </div>
      </div>

      {isPending && <div className="card admin-state" role="status">Loading users…</div>}

      {isError && !isPending && (
        <div className="card admin-state" role="alert">
          <p>
            {status === 503
              ? "Admin access is unavailable until the server has a real JWT secret."
              : "Could not load users."}
          </p>
          {status !== 503 && (
            <button className="btn btn-ghost" style={{ width: "auto" }} onClick={() => void refetch()}>
              Try again
            </button>
          )}
        </div>
      )}

      {data && !isError && (
        <>
          <div className="admin-stats">
            <div className="card card-pad">
              <div className="stat-lbl">Total users</div>
              <div className="stat-big">{data.total_users.toLocaleString()}</div>
            </div>
            <div className="card card-pad">
              <div className="stat-lbl">Non-zero transactions</div>
              <div className="stat-big">{data.total_transactions.toLocaleString()}</div>
            </div>
          </div>

          <div className="card">
            {total === 0 ? (
              <div className="admin-state">No users yet.</div>
            ) : (
              <>
                {rows.length === 0 ? (
                  <div className="admin-state">No users on this page.</div>
                ) : (
                  <table className="tbl admin-table">
                    <thead>
                      <tr>
                        <th scope="col">User</th>
                        <th scope="col">Joined</th>
                        <th scope="col" className="admin-count">Non-zero transactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((user) => {
                        const { primary, secondary } = userLabels(user);
                        return (
                          <tr key={user.user_id}>
                            <td className="admin-user">
                              <div className="admin-user-name">{primary}</div>
                              {secondary && <div className="admin-user-sub">{secondary}</div>}
                            </td>
                            <td data-label="Joined">{joinedDate(user.joined_at)}</td>
                            <td data-label="Non-zero transactions" className="admin-count">
                              {user.transaction_count.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="admin-pager">
                  <span className="muted" aria-live="polite">
                    {first}–{last} of {total.toLocaleString()}
                  </span>
                  <div className="admin-pager-actions">
                    <button
                      className="btn btn-ghost"
                      disabled={offset === 0 || isFetching}
                      onClick={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-ghost"
                      disabled={offset + ADMIN_PAGE_SIZE >= total || isFetching}
                      onClick={() => setOffset(offset + ADMIN_PAGE_SIZE)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
