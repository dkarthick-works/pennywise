import axios from "axios";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUnmappedCategories,
  getCategoryGroups,
  getTransactionCategoryTexts,
  createCategoryGroup,
  createCategoryMapping,
  updateCategoryGroup,
  deleteCategoryGroup,
  deleteCategoryMapping,
} from "../api/ledger";
import { IconX } from "../components/ui/Icons";
import type { CategoryGroup } from "../types";

type Tab = "unmapped" | "groups";

const catKeys = {
  unmapped: ["categories", "unmapped"] as const,
  groups: ["categories", "groups"] as const,
  texts: (groupId: string, q: string) => ["categories", "texts", groupId, q] as const,
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["categories"] });
  qc.invalidateQueries({ queryKey: ["group-spend"] });
}

function errorMessage(e: unknown, fallback: string) {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { error?: string })?.error || fallback;
  }
  return e instanceof Error ? e.message : fallback;
}

function useDebouncedValue<T>(value: T, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

// ─── Assign row (Needs Mapping tab) ─────────────────────────────────────────

function AssignRow({
  text,
  groups,
  onDone,
}: {
  text: string;
  groups: CategoryGroup[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(groups.length ? "existing" : "new");
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState("");

  const assign = useMutation({
    mutationFn: (groupId?: string) => {
      if (groupId) return createCategoryMapping({ raw_category: text, group_id: groupId });
      const name = newName.trim();
      if (!name) throw new Error("Enter a group name");
      return createCategoryMapping({ raw_category: text, group_name: name });
    },
    onSuccess: onDone,
    onError: (e: unknown) => {
      setErr(errorMessage(e, "Could not save mapping"));
    },
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexWrap: "wrap",
        alignItems: "stretch",
        gap: 9,
        padding: "14px 0",
        borderBottom: "1px solid var(--border-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{text}</span>

        {groups.length > 0 && (
          <div className="seg" style={{ flex: "none" }}>
            <button className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>
              Existing
            </button>
            <button className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
              New group
            </button>
          </div>
        )}
      </div>

      {mode === "existing" && groups.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {groups.map((g) => (
            <button
              key={g.id}
              className="btn btn-soft"
              style={{ padding: "7px 12px", borderRadius: 999 }}
              disabled={assign.isPending}
              onClick={() => { setErr(""); assign.mutate(g.id); }}
              title={`Map "${text}" to ${g.name}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 180px", maxWidth: 280, height: 36, padding: "7px 10px" }}
            placeholder="Group name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && assign.mutate(undefined)}
          />
          <button
            className="btn btn-primary"
            style={{ padding: "7px 14px", width: "auto", height: 36 }}
            disabled={assign.isPending}
            onClick={() => { setErr(""); assign.mutate(undefined); }}
          >
            Create & map
          </button>
        </div>
      )}

      {err && <span style={{ color: "var(--neg)", fontSize: 12.5, width: "100%" }}>{err}</span>}
    </div>
  );
}

// ─── Group card (Groups tab) ────────────────────────────────────────────────

function AddCategoryTextControl({
  group,
  onChanged,
}: {
  group: CategoryGroup;
  onChanged: () => void;
}) {
  const [term, setTerm] = useState("");
  const [err, setErr] = useState("");
  const query = term.trim();
  const debouncedQuery = useDebouncedValue(query);

  const { data: matches = [], isFetching } = useQuery({
    queryKey: catKeys.texts(group.id, debouncedQuery),
    queryFn: () => getTransactionCategoryTexts({ q: debouncedQuery, excludeGroupId: group.id }),
    enabled: debouncedQuery.length > 0,
  });

  const add = useMutation({
    mutationFn: (rawCategory: string) =>
      createCategoryMapping({ raw_category: rawCategory, group_id: group.id }),
    onSuccess: () => {
      setTerm("");
      setErr("");
      onChanged();
    },
    onError: (e: unknown) => {
      setErr(errorMessage(e, "Could not add category text"));
    },
  });

  return (
    <div style={{ marginBottom: 14 }}>
      <input
        className="input"
        style={{ width: "100%", maxWidth: 360, padding: "8px 12px" }}
        placeholder="Search transaction text to add…"
        value={term}
        onChange={(e) => { setTerm(e.target.value); setErr(""); }}
      />
      <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
        Add labels from your transactions, even if they already belong to another group.
      </p>

      {err && <p style={{ color: "var(--neg)", fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}

      {debouncedQuery && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {isFetching ? (
            <span className="muted" style={{ fontSize: 12.5 }}>Searching…</span>
          ) : matches.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>No available transaction text found.</span>
          ) : (
            matches.map((text) => (
              <button
                key={text}
                className="btn btn-soft"
                style={{ justifyContent: "flex-start", padding: "7px 10px", width: "100%" }}
                disabled={add.isPending}
                onClick={() => add.mutate(text)}
              >
                {text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  onChanged,
}: {
  group: CategoryGroup;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);

  const rename = useMutation({
    mutationFn: () => updateCategoryGroup(group.id, { name: name.trim() }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const removeGroup = useMutation({
    mutationFn: () => deleteCategoryGroup(group.id),
    onSuccess: onChanged,
  });

  const removeMapping = useMutation({
    mutationFn: (mappingId: string) => deleteCategoryMapping(mappingId),
    onSuccess: onChanged,
  });

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {editing ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
            <input
              className="input"
              style={{ maxWidth: 220, padding: "7px 10px" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && rename.mutate()}
            />
            <button className="btn btn-primary" style={{ padding: "6px 12px" }} onClick={() => rename.mutate()}>
              Save
            </button>
            <button className="btn btn-soft" style={{ padding: "6px 12px" }} onClick={() => { setEditing(false); setName(group.name); }}>
              Cancel
            </button>
          </div>
        ) : (
          <h3 className="card-h" style={{ margin: 0 }}>{group.name}</h3>
        )}
        {!editing && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-soft" style={{ padding: "6px 12px" }} onClick={() => setEditing(true)}>
              Rename
            </button>
            <button
              className="btn btn-soft"
              style={{ padding: "6px 12px", color: "var(--neg)" }}
              onClick={() => { if (confirm(`Delete group "${group.name}" and its mappings? Text in other groups will stay there.`)) removeGroup.mutate(); }}
            >
              Delete group
            </button>
          </div>
        )}
      </div>

      <AddCategoryTextControl group={group} onChanged={onChanged} />

      {group.mappings.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          No category text in this group yet. Search your transactions to add some.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {group.mappings.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                padding: "8px 10px",
                background: "var(--surface-2)",
                borderRadius: 8,
              }}
            >
              <span style={{ flex: "1 1 120px", fontSize: 13.5, fontWeight: 500 }}>{m.raw_category}</span>
              <button
                className="x-btn"
                title="Remove from this group"
                onClick={() => { if (confirm(`Remove "${m.raw_category}" from "${group.name}"? It may remain in other groups.`)) removeMapping.mutate(m.id); }}
              >
                <IconX size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

function CustomGroupCard({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a group name");
      return createCategoryGroup({ name: trimmed });
    },
    onSuccess: () => {
      setName("");
      setErr("");
      onCreated();
    },
    onError: (e: unknown) => {
      setErr(errorMessage(e, "Could not create group"));
    },
  });

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <h3 className="card-h" style={{ marginBottom: 4 }}>Custom groups</h3>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
        Create an optional group, then open Groups to search your transaction text and add labels.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 180px", maxWidth: 280, height: 36, padding: "7px 10px" }}
          placeholder="Group name…"
          value={name}
          onChange={(e) => { setName(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && create.mutate()}
        />
        <button
          className="btn btn-primary"
          style={{ padding: "7px 14px", width: "auto", height: 36 }}
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create group
        </button>
      </div>
      {err && <p style={{ color: "var(--neg)", fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}
    </div>
  );
}

export function CategoriesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("unmapped");
  const [search, setSearch] = useState("");

  const { data: unmapped = [], isLoading: loadingUnmapped } = useQuery({
    queryKey: catKeys.unmapped,
    queryFn: getUnmappedCategories,
  });

  const { data: groups = [], isLoading: loadingGroups } = useQuery({
    queryKey: catKeys.groups,
    queryFn: getCategoryGroups,
  });

  const refresh = () => invalidateAll(qc);

  const filteredUnmapped = unmapped.filter((t) =>
    t.toLowerCase().includes(search.toLowerCase())
  );

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    g.mappings.some((m) => m.raw_category.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="content fade-in" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-sub">
            Map transaction labels to high-level groups for future dashboards.
          </p>
        </div>
        <div className="seg">
          <button className={tab === "unmapped" ? "on" : ""} onClick={() => setTab("unmapped")}>
            Needs mapping
          </button>
          <button className={tab === "groups" ? "on" : ""} onClick={() => setTab("groups")}>
            Groups
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ width: "100%", maxWidth: 360, padding: "8px 12px" }}
          placeholder="Search category text or group…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {tab === "unmapped" ? (
        <div className="card card-pad">
          <h3 className="card-h" style={{ marginBottom: 4 }}>Unmapped category text</h3>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 16px" }}>
            These labels appear in your transactions but are not assigned to any group yet.
          </p>

          {loadingUnmapped || loadingGroups ? (
            <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
          ) : filteredUnmapped.length === 0 ? (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                {unmapped.length === 0
                  ? "All category text has at least one group. Use custom groups for optional overlap."
                  : "No matches."}
              </p>
              {unmapped.length === 0 && (
                <CustomGroupCard
                  onCreated={() => {
                    refresh();
                    setTab("groups");
                  }}
                />
              )}
            </>
          ) : (
            filteredUnmapped.map((text) => (
              <AssignRow key={text} text={text} groups={groups} onDone={refresh} />
            ))
          )}
        </div>
      ) : (
        <>
          {loadingGroups ? (
            <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
          ) : filteredGroups.length === 0 ? (
            <div className="card card-pad">
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {groups.length === 0
                  ? "No groups yet. Finish primary mapping, then create a custom group from Needs mapping."
                  : "No matches."}
              </p>
            </div>
          ) : (
            filteredGroups.map((g) => (
              <GroupCard key={g.id} group={g} onChanged={refresh} />
            ))
          )}
        </>
      )}
    </div>
  );
}
