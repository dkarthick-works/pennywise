import axios from "axios";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUnmappedCategories,
  getCategoryGroups,
  getCategoryMappings,
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
  mappings: ["categories", "mappings"] as const,
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["categories"] });
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
      const msg = axios.isAxiosError(e)
        ? (e.response?.data as { error?: string })?.error
        : e instanceof Error ? e.message : undefined;
      setErr(msg || "Could not save mapping");
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
              onClick={() => { if (confirm(`Delete group "${group.name}" and all its mappings?`)) removeGroup.mutate(); }}
            >
              Delete group
            </button>
          </div>
        )}
      </div>

      {group.mappings.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>No mapped category text.</p>
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
                title="Remove mapping"
                onClick={() => { if (confirm(`Remove mapping for "${m.raw_category}"?`)) removeMapping.mutate(m.id); }}
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

  useQuery({
    queryKey: catKeys.mappings,
    queryFn: getCategoryMappings,
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
            These labels appear in your transactions but are not assigned to a group yet.
          </p>

          {loadingUnmapped || loadingGroups ? (
            <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
          ) : filteredUnmapped.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {unmapped.length === 0 ? "All category text is mapped." : "No matches."}
            </p>
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
                  ? "No groups yet. Map category text from the Needs mapping tab."
                  : "No matches."}
              </p>
            </div>
          ) : (
            filteredGroups.map((g) => (
              <GroupCard key={g.id} group={g} onChanged={refresh} />
            ))
          )}

          {/* Existing mappings flat view for edit */}
          {groups.length > 0 && (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <h3 className="card-h" style={{ marginBottom: 12 }}>All mappings</h3>
              <MappingsTable groups={groups} onChanged={refresh} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MappingsTable({ groups, onChanged }: { groups: CategoryGroup[]; onChanged: () => void }) {
  const rows = groups.flatMap((g) =>
    g.mappings.map((m) => ({ ...m, group_id: g.id, group_name: g.name }))
  );

  const remove = useMutation({
    mutationFn: (id: string) => deleteCategoryMapping(id),
    onSuccess: onChanged,
  });

  if (rows.length === 0) {
    return <p className="muted" style={{ fontSize: 13, margin: 0 }}>No mappings yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "8px 0",
            borderBottom: "1px solid var(--border-2)",
          }}
        >
          <span style={{ flex: "1 1 140px", fontSize: 13.5, fontWeight: 500 }}>{r.raw_category}</span>
          <IconArrowInline />
          <span style={{ flex: "1 1 120px", fontSize: 13.5, fontWeight: 600 }}>{r.group_name}</span>
          <button className="x-btn" onClick={() => { if (confirm(`Remove mapping for "${r.raw_category}"?`)) remove.mutate(r.id); }}>
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function IconArrowInline() {
  return (
    <span className="muted" style={{ fontSize: 12, flex: "none" }}>→</span>
  );
}
