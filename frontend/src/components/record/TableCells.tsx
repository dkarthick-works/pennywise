// Shared inline-editable table cells.
// All cells use local state so only the final value (on blur / commit)
// triggers an API mutation — not every keystroke.

import { useState, useEffect, useRef, useId, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { getTransactionNameSuggestions } from "../../api/ledger";
import {
  normalizeTransactionNameQuery,
  transactionNameSuggestionKeys,
} from "../../lib/transactionNameSuggestions";
import {
  formatIndianAmount,
  isNegativeAmount,
  parseIndianAmount,
  POSITIVE_AMOUNT_MESSAGE,
  type ParsedAmount,
} from "../../lib/parseAmount";
import type {
  TransactionNameSuggestion,
  TransactionNameSuggestionSection,
} from "../../types";

// ─── Amount ───────────────────────────────────────────────────────────────
// Displays formatted Indian number while not focused; parses and saves on blur.

export function AmountInput({
  value,
  onChange,
  onEnterCommit,
  onRejected,
  placeholder = "—",
  align = "right",
  /** When true, parse and report to parent on every keystroke (form-style entry). */
  immediate = false,
  /** Hand the negative number to the parent, which already shows its own message. */
  reportNegative = false,
}: {
  value: number | null;
  onChange: (n: number | null, decimalPlaces?: number) => void;
  onEnterCommit?: (parsed: number | null, decimalPlaces: number) => void;
  /** Tracks whether the current draft text is negative. Sync, so a later save can refuse it. */
  onRejected?: (rejected: boolean) => void;
  placeholder?: string;
  align?: string;
  immediate?: boolean;
  reportNegative?: boolean;
}) {
  const fmt = (n: number | null) => (n ? formatIndianAmount(n) : "");
  const [local, setLocal] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const errorId = `${useId().replace(/:/g, "")}-amount-error`;

  useEffect(() => {
    // Keep a rejected draft on screen. Replacing it with the saved value would
    // hide the minus sign the user just typed.
    if (!focused && !error) setLocal(fmt(value));
  }, [value, focused, error]);

  function reject(parsed: ParsedAmount, commit: boolean) {
    if (reportNegative) setError("");
    else setError(POSITIVE_AMOUNT_MESSAGE);
    onRejected?.(true);
    if (!reportNegative) {
      if (commit) setFocused(false);
      return;
    }
    onChange(parsed.value, parsed.decimalPlaces);
    if (commit) {
      setLocal(fmt(parsed.value));
      setFocused(false);
    }
  }

  function accept(parsed: ParsedAmount, phase: "edit" | "commit" | "enter") {
    setError("");
    onRejected?.(false);
    if (phase === "edit") {
      if (immediate) onChange(parsed.value, parsed.decimalPlaces);
      return;
    }
    onChange(parsed.value, parsed.decimalPlaces);
    setLocal(fmt(parsed.value));
    setFocused(false);
    if (phase === "enter") onEnterCommit?.(parsed.value, parsed.decimalPlaces);
  }

  function apply(raw: string, phase: "edit" | "commit" | "enter") {
    const parsed = parseIndianAmount(raw);
    if (isNegativeAmount(parsed)) {
      reject(parsed, phase !== "edit");
      if (reportNegative && phase === "enter") onEnterCommit?.(parsed.value, parsed.decimalPlaces);
      return;
    }
    accept(parsed, phase);
  }

  return (
    <>
      <input
        className="cell-input num"
        inputMode="decimal"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        style={{ textAlign: align as "left" | "right", minWidth: 110 }}
        value={local}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          apply(next, "edit");
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => apply(local, "commit")}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          apply(local, "enter");
        }}
      />
      {error ? (
        <div id={errorId} style={{ color: "var(--neg)", fontSize: 12, marginTop: 4 }}>
          {error}
        </div>
      ) : null}
    </>
  );
}

// ─── Date ─────────────────────────────────────────────────────────────────
// Saves on blur so partial manual edits don't fire requests.

export function DateCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value ?? "");

  useEffect(() => setLocal(value ?? ""), [value]);

  return (
    <input
      type="date"
      className="cell-input num"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      style={{ color: local ? "var(--ink)" : "var(--ink-3)", minWidth: 142 }}
    />
  );
}

// ─── Plain category input (Essential / Flexible rows) ─────────────────────
// Saves on blur; shows current value instantly so edits feel responsive.

export function RowCategoryInput({
  value,
  onChange,
  placeholder = "Category",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => setLocal(value), [value]);

  return (
    <input
      className="cell-input"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

// ─── Category autocomplete (Daily rows + Daily/Income quick-add) ──────────

const EMPTY_TRANSACTION_NAME_SUGGESTIONS: TransactionNameSuggestion[] = [];

export function CategoryInput({
  value,
  onChange,
  onCommit,
  onSubmit,
  section,
  placeholder = "Category",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  /** Enter commits using the current local value (not a stale parent closure). */
  onSubmit?: (v: string) => void;
  section: TransactionNameSuggestionSection;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [typedSinceFocus, setTypedSinceFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [activeItemsKey, setActiveItemsKey] = useState("");
  const [dropPosition, setDropPosition] = useState<{
    top: number | undefined;
    bottom: number | undefined;
    left: number;
    width: number;
    maxHeight: number;
  }>({ top: 0, bottom: undefined, left: 0, width: 0, maxHeight: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listboxId = `${useId().replace(/:/g, "")}-transaction-name-listbox`;

  const trimmedQuery = value.trim();
  const normalizedQuery = normalizeTransactionNameQuery(value);
  const queryLength = [...trimmedQuery].length;
  const queryIsValid = queryLength >= 2 && queryLength <= 100;

  useEffect(() => {
    if (!focused || !typedSinceFocus || dismissed || !queryIsValid) return;
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
      setActiveIndex(-1);
      setActiveItemsKey("");
    }, 100);
    return () => window.clearTimeout(timer);
  }, [dismissed, focused, queryIsValid, trimmedQuery, typedSinceFocus]);

  const normalizedDebouncedQuery = normalizeTransactionNameQuery(debouncedQuery);
  const debouncedLength = [...debouncedQuery].length;
  const queryEnabled =
    focused &&
    typedSinceFocus &&
    !dismissed &&
    queryIsValid &&
    debouncedLength >= 2 &&
    debouncedLength <= 100 &&
    normalizedQuery === normalizedDebouncedQuery;

  const suggestionsQuery = useQuery({
    queryKey: transactionNameSuggestionKeys.search(section, debouncedQuery),
    queryFn: ({ signal }) =>
      getTransactionNameSuggestions({ section, q: debouncedQuery, limit: 10 }, signal),
    enabled: queryEnabled,
  });
  const items = suggestionsQuery.data?.items ?? EMPTY_TRANSACTION_NAME_SUGGESTIONS;
  const itemsKey = `${normalizedDebouncedQuery}\u0000${items.map((item) => item.name).join("\u0000")}`;
  const currentActiveIndex = activeItemsKey === itemsKey && activeIndex < items.length
    ? activeIndex
    : -1;
  const showDropdown =
    queryEnabled &&
    !suggestionsQuery.isFetching &&
    !suggestionsQuery.isError &&
    items.length > 0;

  useEffect(() => {
    if (!showDropdown) return;
    let frame = 0;

    function updatePosition() {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      const margin = 8;
      const gap = 5;
      const availableWidth = Math.max(0, window.innerWidth - margin * 2);
      const width = Math.min(Math.max(rect.width, 180), availableWidth);
      const left = Math.max(
        margin,
        Math.min(rect.left, window.innerWidth - width - margin)
      );
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
      const spaceAbove = Math.max(0, rect.top - gap - margin);
      const placeAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(240, placeAbove ? spaceAbove : spaceBelow);

      setDropPosition({
        top: placeAbove ? undefined : rect.bottom + gap,
        bottom: placeAbove ? window.innerHeight - rect.top + gap : undefined,
        left,
        width,
        maxHeight,
      });
    }

    function schedulePositionUpdate() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    }

    schedulePositionUpdate();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [items.length, showDropdown]);

  useEffect(() => {
    if (!showDropdown || currentActiveIndex < 0) return;
    optionRefs.current[currentActiveIndex]?.scrollIntoView({ block: "nearest" });
  }, [currentActiveIndex, showDropdown]);

  useEffect(() => {
    if (!focused) return;
    function onDocumentPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapperRef.current?.contains(target) || listboxRef.current?.contains(target)) return;
      setDismissed(true);
      setActiveIndex(-1);
      setActiveItemsKey("");
    }
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }, [focused]);

  function acceptSuggestion(name: string) {
    onChange(name);
    setDismissed(true);
    setDebouncedQuery("");
    setActiveIndex(-1);
    setActiveItemsKey("");
    inputRef.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (showDropdown && e.key === "ArrowDown") {
      e.preventDefault();
      setActiveItemsKey(itemsKey);
      setActiveIndex(currentActiveIndex < 0 ? 0 : (currentActiveIndex + 1) % items.length);
      return;
    }
    if (showDropdown && e.key === "ArrowUp") {
      e.preventDefault();
      setActiveItemsKey(itemsKey);
      setActiveIndex(currentActiveIndex < 0 ? items.length - 1 : (currentActiveIndex - 1 + items.length) % items.length);
      return;
    }
    if (e.key === "Enter" && showDropdown && currentActiveIndex >= 0) {
      e.preventDefault();
      acceptSuggestion(items[currentActiveIndex].name);
      return;
    }
    if (e.key === "Enter" && onSubmit) {
      e.preventDefault();
      e.stopPropagation();
      onSubmit(value);
      return;
    }
    if (e.key === "Escape" && focused && typedSinceFocus) {
      e.preventDefault();
      setDismissed(true);
      setDebouncedQuery("");
      setActiveIndex(-1);
      setActiveItemsKey("");
    }
  }

  const dropdown = showDropdown
    ? createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="card"
          onPointerDown={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            top: dropPosition.top,
            bottom: dropPosition.bottom,
            left: dropPosition.left,
            width: dropPosition.width,
            maxHeight: dropPosition.maxHeight,
            overflowY: "auto",
            zIndex: 40,
            boxShadow: "var(--sh-lg)",
            padding: 5,
          }}
        >
          {items.map((item, index) => {
            const optionId = `${listboxId}-option-${index}`;
            const active = index === currentActiveIndex;
            return (
              <button
                key={`${item.name}-${index}`}
                ref={(element) => { optionRefs.current[index] = element; }}
                id={optionId}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={-1}
                onPointerDown={(event) => {
                  event.preventDefault();
                  acceptSuggestion(item.name);
                }}
                onMouseEnter={() => {
                  setActiveItemsKey(itemsKey);
                  setActiveIndex(index);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  border: "none",
                  borderRadius: 7,
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--accent-ink)" : "var(--ink)",
                  padding: "8px 10px",
                  textAlign: "left",
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.name}
              </button>
            );
          })}
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input
        ref={inputRef}
        className="cell-input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={showDropdown && currentActiveIndex >= 0 ? `${listboxId}-option-${currentActiveIndex}` : undefined}
        onFocus={() => {
          setFocused(true);
          setTypedSinceFocus(false);
          setDismissed(false);
          setDebouncedQuery("");
          setActiveIndex(-1);
          setActiveItemsKey("");
        }}
        onBlur={() => {
          setFocused(false);
          setDismissed(true);
          setDebouncedQuery("");
          setActiveIndex(-1);
          setActiveItemsKey("");
          onCommit?.(value);
        }}
        onKeyDown={onKey}
        onChange={(e) => {
          setTypedSinceFocus(true);
          setDismissed(false);
          setDebouncedQuery("");
          setActiveIndex(-1);
          setActiveItemsKey("");
          onChange(e.target.value);
        }}
      />
      {dropdown}
    </div>
  );
}
