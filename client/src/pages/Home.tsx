/**
 * Ledger Light — SQL Query Runner
 * Main console page. Layout: header strip → [ schema | editor over results | history ].
 * Editor and results share the center column with a resizable divider.
 * Design alignment: Ledger Light organizes browser-local drafts with quiet
 * filing cues while keeping live SQL execution visually central. Search state
 * remains temporary so browser-local filing data never changes accidentally.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SchemaSidebar from "@/components/SchemaSidebar";
import HistoryRail from "@/components/HistoryRail";
import type { QueryResult } from "@/lib/engine";
import { deleteHistoryEntry, deleteWorkspace, deleteWorkspaceRevisions, findDuplicateWorkspace, getWorkspaceRevisions, listWorkspaceLabels, loadHistory, loadWorkspaceRevisions, loadWorkspaces, mergeImportedWorkspaces, parseWorkspaceArchive, recordWorkspaceRevision, saveHistory, saveWorkspaceRevisions, saveWorkspaces, serializeWorkspaceArchive, toggleHistoryPin, upsertWorkspace, type QueryHistoryEntry, type WorkspaceRevision } from "@/lib/preferences";
import { SAMPLE_QUERIES } from "@/lib/catalog";
import { copySharedQueryLink, getSharedQueryLinkDetails, readSharedQueryFromUrl, removeSharedQueryFromUrl, type ShareLinkMode } from "@/lib/shareLink";
import { toast } from "sonner";
import { AlertTriangle, Timer, Rows3, Loader2 } from "lucide-react";

// Deferred panes keep the console shell responsive while editor and table code load independently.
const QueryEditor = lazy(() => import("@/components/QueryEditor"));
const ResultsTable = lazy(() => import("@/components/ResultsTable"));

function clock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function createWorkspaceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Home() {
  const [sharedQuery] = useState(() => (typeof window === "undefined" ? null : readSharedQueryFromUrl(window.location.href)));
  const [sharedReadOnly, setSharedReadOnly] = useState(() => sharedQuery !== null);
  const [sql, setSql] = useState(() => sharedQuery ?? SAMPLE_QUERIES[1].sql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>(() => loadHistory());
  const [workspaces, setWorkspaces] = useState(() => loadWorkspaces());
  const [workspaceRevisions, setWorkspaceRevisions] = useState(() => loadWorkspaceRevisions());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Untitled query");
  const [workspaceLabel, setWorkspaceLabel] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [activeLabelFilters, setActiveLabelFilters] = useState<string[]>([]);
  const [shareLinkMode, setShareLinkMode] = useState<ShareLinkMode>("standard");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [dividerY, setDividerY] = useState(36); // editor share %; results deliberately lead the console
  const [compactPanel, setCompactPanel] = useState<"schema" | "history" | null>(null);
  const centerPaneRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(history.reduce((highestId, entry) => Math.max(highestId, entry.id), 0));
  const loadedRef = useRef(false);
  const autoRunRef = useRef(false);
  const enginePromiseRef = useRef<Promise<typeof import("@/lib/engine")> | null>(null);

  const loadEngine = useCallback(() => {
    if (!enginePromiseRef.current) {
      enginePromiseRef.current = import("@/lib/engine");
    }
    return enginePromiseRef.current;
  }, []);

  const run = useCallback(async (queryText?: string) => {
    const text = (queryText ?? sql).trim();
    if (!text) {
      setError("Empty query. Write a SELECT and press Run.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const { executeQuery } = await loadEngine();
      const r = await executeQuery(text);
      setResult(r);
      if (!loadedRef.current) {
        setCounts({ customers: 2000, products: 400, orders: 50000, order_items: 120000, reviews: 18000 });
        // NOTE: counts above mirror the seed volumes; kept in sync with seed.ts
        loadedRef.current = true;
      }
      idRef.current += 1;
      setHistory((h) =>
        [
          {
            id: idRef.current,
            label: "Run",
            sql: text,
            elapsedMs: r.elapsedMs,
            rowCount: r.rows.length,
            ts: clock(),
            pinned: false,
          },
          ...h,
        ].slice(0, 50)
      );
      if (r.rows.length > 5000) {
        toast.success(`${r.rows.length.toLocaleString("en-US")} rows returned in ${r.elapsedMs} ms`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setResult(null);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }, [loadEngine, sql]);

  // Open the console as a populated ledger once, after the component mounts.
  // Effects keep this state change out of the render phase and the ref avoids
  // rerunning when the query callback changes after an editor update.
  useEffect(() => {
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    void run(sql);
  }, [run]);

  useEffect(() => {
    if (sharedQuery) toast("Shared query loaded as read-only. Make an editable copy to change it.");
  }, [sharedQuery]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    saveWorkspaces(workspaces);
  }, [workspaces]);

  useEffect(() => {
    saveWorkspaceRevisions(workspaceRevisions);
  }, [workspaceRevisions]);

  const restore = useCallback((s: string) => {
    if (sharedReadOnly) {
      toast.error("This shared query is read-only. Make an editable copy first.");
      return;
    }
    setSql(s);
  }, [sharedReadOnly]);
  const insertToken = useCallback((token: string) => {
    if (sharedReadOnly) {
      toast.error("This shared query is read-only. Make an editable copy first.");
      return;
    }
    setSql((s) => s + token);
  }, [sharedReadOnly]);
  const togglePin = useCallback((id: number) => {
    setHistory((entries) => toggleHistoryPin(entries, id));
  }, []);
  const removeHistoryEntry = useCallback((id: number) => {
    setHistory((entries) => deleteHistoryEntry(entries, id));
    toast.success("Saved query removed");
  }, []);
  const loadWorkspace = useCallback((id: string) => {
    if (sharedReadOnly) {
      toast.error("This shared query is read-only. Make an editable copy first.");
      return;
    }
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) return;
    setSql(workspace.sql);
    setActiveWorkspaceId(workspace.id);
    setWorkspaceName(workspace.name);
    setWorkspaceLabel(workspace.label ?? "");
    toast.success(`Loaded workspace: ${workspace.name}`);
  }, [sharedReadOnly, workspaces]);
  const saveWorkspace = useCallback(() => {
    const trimmedName = workspaceName.trim() || "Untitled query";
    const active = workspaces.find((item) => item.id === activeWorkspaceId);
    const now = Date.now();
    const workspace = {
      id: active?.id ?? createWorkspaceId(),
      name: trimmedName,
      label: workspaceLabel,
      sql: sql.trim(),
      createdAt: active?.createdAt ?? now,
      updatedAt: now,
    };
    if (!workspace.sql) {
      toast.error("Write a SELECT query before saving a workspace.");
      return;
    }
    if (findDuplicateWorkspace(workspaces, trimmedName, activeWorkspaceId)) {
      toast.error(`A workspace named “${trimmedName}” already exists. Choose another name.`);
      return;
    }
    if (active && (active.name !== workspace.name || active.label !== workspace.label || active.sql !== workspace.sql)) {
      setWorkspaceRevisions((entries) => recordWorkspaceRevision(entries, active));
    }
    setWorkspaces((entries) => upsertWorkspace(entries, workspace));
    setActiveWorkspaceId(workspace.id);
    setWorkspaceName(workspace.name);
    toast.success(active ? "Workspace saved" : "Workspace created");
  }, [activeWorkspaceId, sql, workspaceLabel, workspaceName, workspaces]);
  const newWorkspace = useCallback(() => {
    setActiveWorkspaceId(null);
    setWorkspaceName("Untitled query");
    setWorkspaceLabel("");
    toast("New workspace ready. Name it, then save your current query.");
  }, []);
  const removeWorkspace = useCallback(() => {
    if (!activeWorkspaceId) return;
    setWorkspaces((entries) => deleteWorkspace(entries, activeWorkspaceId));
    setWorkspaceRevisions((entries) => deleteWorkspaceRevisions(entries, activeWorkspaceId));
    setActiveWorkspaceId(null);
    setWorkspaceName("Untitled query");
    setWorkspaceLabel("");
    toast.success("Workspace deleted");
  }, [activeWorkspaceId]);
  const restoreWorkspaceRevision = useCallback((revision: WorkspaceRevision) => {
    if (sharedReadOnly) {
      toast.error("This shared query is read-only. Make an editable copy first.");
      return;
    }
    setSql(revision.sql);
    setWorkspaceName(revision.name);
    setWorkspaceLabel(revision.label ?? "");
    toast.success("Earlier revision restored as a draft. Save to keep it.");
  }, [sharedReadOnly]);
  const duplicateWorkspace = useMemo(
    () => findDuplicateWorkspace(workspaces, workspaceName, activeWorkspaceId),
    [activeWorkspaceId, workspaceName, workspaces]
  );
  const workspaceLabels = useMemo(() => listWorkspaceLabels(workspaces), [workspaces]);
  const shareLinkDetails = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      return getSharedQueryLinkDetails(sql, window.location.href, shareLinkMode);
    } catch {
      return null;
    }
  }, [shareLinkMode, sql]);
  const shareLinkHint = shareLinkDetails
    ? `${shareLinkDetails.length.toLocaleString("en-US")} characters${shareLinkDetails.needsCaution ? " · long links can be blocked by some tools" : " · ready to copy"}`
    : null;
  const shareQuery = useCallback(async () => {
    try {
      const details = getSharedQueryLinkDetails(sql, window.location.href, shareLinkMode);
      await copySharedQueryLink(sql, window.location.href, shareLinkMode);
      if (details.needsCaution) toast.warning(`Read-only link copied (${details.length.toLocaleString("en-US")} characters). Some tools may reject long URLs.`);
      else toast.success(`Read-only query link copied (${details.length.toLocaleString("en-US")} characters)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a share link.");
    }
  }, [shareLinkMode, sql]);
  const exportWorkspaces = useCallback(() => {
    if (typeof document === "undefined") return;
    const blob = new Blob([serializeWorkspaceArchive(workspaces)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "queryline-workspaces.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(`${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} exported`);
  }, [workspaces]);
  const importWorkspaces = useCallback(async (file: File) => {
    try {
      const incoming = parseWorkspaceArchive(await file.text());
      if (!incoming) {
        toast.error("Choose a valid Queryline workspace JSON file.");
        return;
      }
      const merged = mergeImportedWorkspaces(workspaces, incoming);
      if (merged.imported === 0) {
        toast("No workspaces were imported; names already exist or the local shelf is full.");
        return;
      }
      setWorkspaces(merged.workspaces);
      toast.success(`${merged.imported} workspace${merged.imported === 1 ? "" : "s"} imported${merged.skipped ? ` · ${merged.skipped} duplicate${merged.skipped === 1 ? "" : "s"} skipped` : ""}`);
    } catch {
      toast.error("This workspace file could not be read.");
    }
  }, [workspaces]);
  const makeEditableCopy = useCallback(() => {
    setSharedReadOnly(false);
    setActiveWorkspaceId(null);
    setWorkspaceName("Shared query copy");
    setWorkspaceLabel("");
    if (typeof window !== "undefined") window.history.replaceState({}, "", removeSharedQueryFromUrl(window.location.href));
    toast.success("Editable query copy ready. Name it and save when needed.");
  }, []);

  const metrics = useMemo(() => {
    if (!result) return null;
    return { rows: result.rows.length, ms: result.elapsedMs, cols: result.columns.length };
  }, [result]);

  const setBoundedEditorShare = useCallback((value: number) => {
    setDividerY(Math.min(72, Math.max(22, Math.round(value))));
  }, []);

  const setEditorShareFromPointer = useCallback((clientY: number) => {
    const bounds = centerPaneRef.current?.getBoundingClientRect();
    if (!bounds || bounds.height === 0) return;
    setBoundedEditorShare(((clientY - bounds.top) / bounds.height) * 100);
  }, [setBoundedEditorShare]);

  const resizeDividerWithKey = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setBoundedEditorShare(dividerY - 4);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setBoundedEditorShare(dividerY + 4);
    } else if (event.key === "Home") {
      event.preventDefault();
      setBoundedEditorShare(22);
    } else if (event.key === "End") {
      event.preventDefault();
      setBoundedEditorShare(72);
    }
  }, [dividerY, setBoundedEditorShare]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border/70 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <img
              src="/app-storage/queryline-logo_e1a45a25.png"
              alt="Queryline logo"
              className="h-6 w-6 rounded-[3px] object-contain"
              style={{ filter: "brightness(0) saturate(100%) invert(30%) sepia(19%) saturate(3100%) hue-rotate(143deg) brightness(90%) contrast(92%)" }}
            />
            <h1 className="font-semibold text-lg tracking-tight text-foreground">
              Queryline
            </h1>
          </div>
          <span className="hidden md:inline font-serif italic text-[13px] text-muted-foreground">
            the execution ledger
          </span>
          {metrics && (
            <div className="ml-auto flex items-center gap-2 sm:gap-4 text-[10px] sm:text-[11px] font-mono text-muted-foreground whitespace-nowrap">
              <span className="inline-flex items-center gap-1 text-primary">
                <Rows3 className="h-3 w-3" /> {metrics.rows.toLocaleString("en-US")} rows
              </span>
              <span className="inline-flex items-center gap-1 text-primary">
                <Timer className="h-3 w-3" /> {metrics.ms} ms
              </span>
              <span className="inline-flex items-center gap-1">
                {metrics.cols} cols
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Compact navigation keeps schema, samples, and history reachable below desktop widths. */}
      <div className="lg:hidden shrink-0 flex items-center border-b border-border/70 bg-card/60">
        <button
          type="button"
          onClick={() => setCompactPanel((panel) => (panel === "schema" ? null : "schema"))}
          className="flex-1 px-3 py-2 text-left text-[11px] uppercase tracking-widest font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          aria-expanded={compactPanel === "schema"}
          aria-controls="compact-schema-panel"
        >
          Schema & samples
        </button>
        <button
          type="button"
          onClick={() => setCompactPanel((panel) => (panel === "history" ? null : "history"))}
          className="flex-1 border-l border-border/70 px-3 py-2 text-left text-[11px] uppercase tracking-widest font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          aria-expanded={compactPanel === "history"}
          aria-controls="compact-history-panel"
        >
          History{history.length > 0 ? ` (${history.length})` : ""}
        </button>
      </div>
      {compactPanel === "schema" && (
        <div id="compact-schema-panel" className="lg:hidden shrink-0 border-b border-border/70">
          <SchemaSidebar
            className="w-full h-[38vh] border-r-0"
            counts={counts}
            onInsertTable={(token) => {
              insertToken(token);
              if (!sharedReadOnly) setCompactPanel(null);
            }}
            onLoadSample={(label, query) => {
              if (sharedReadOnly) {
                toast.error("This shared query is read-only. Make an editable copy first.");
                return;
              }
              setSql(query);
              setCompactPanel(null);
              toast(`Loaded: ${label}`);
            }}
            samples={SAMPLE_QUERIES}
          />
        </div>
      )}
      {compactPanel === "history" && (
        <div id="compact-history-panel" className="lg:hidden shrink-0 border-b border-border/70">
          <HistoryRail
            className="w-full h-[38vh] border-l-0"
            entries={history}
            onRestore={(query) => {
              restore(query);
              setCompactPanel(null);
            }}
            onTogglePin={togglePin}
            onDelete={removeHistoryEntry}
          />
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0 min-w-0">
        <SchemaSidebar
          className="hidden lg:flex"
          counts={counts}
          onInsertTable={insertToken}
          onLoadSample={(label, s) => {
            if (sharedReadOnly) {
              toast.error("This shared query is read-only. Make an editable copy first.");
              return;
            }
            setSql(s);
            toast(`Loaded: ${label}`);
          }}
          samples={SAMPLE_QUERIES}
        />

        {/* Center column */}
        <div ref={centerPaneRef} className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Editor pane */}
          <div className="flex flex-col shrink-0 min-h-0 overflow-hidden border-b border-border/45 bg-secondary/[0.01]" style={{ flexBasis: `${dividerY}%` }}>
            <div className="px-4 py-1 border-b border-border/30 flex items-center gap-2 bg-transparent shrink-0">
              <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/55">Query draft</span>
              {running && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> executing
                </span>
              )}
            </div>
            <Suspense fallback={<div className="flex-1 p-4 text-xs font-mono text-muted-foreground">Loading editor…</div>}>
              <QueryEditor
                value={sql}
                onChange={setSql}
                onRun={run}
                running={running}
                workspaces={workspaces}
                        activeWorkspaceId={activeWorkspaceId}
                        workspaceName={workspaceName}
                        onWorkspaceNameChange={setWorkspaceName}
                        workspaceLabel={workspaceLabel}
                        onWorkspaceLabelChange={setWorkspaceLabel}
                        workspaceLabels={workspaceLabels}
                        workspaceSearch={workspaceSearch}
                        onWorkspaceSearchChange={setWorkspaceSearch}
                        activeLabelFilters={activeLabelFilters}
                        onActiveLabelFiltersChange={setActiveLabelFilters}
                onLoadWorkspace={loadWorkspace}
                onSaveWorkspace={saveWorkspace}
                onNewWorkspace={newWorkspace}
                onDeleteWorkspace={removeWorkspace}
                isDuplicateWorkspaceName={Boolean(duplicateWorkspace)}
                readOnly={sharedReadOnly}
                onShareQuery={() => void shareQuery()}
                shareLinkMode={shareLinkMode}
                onShareLinkModeChange={setShareLinkMode}
                onMakeEditableCopy={makeEditableCopy}
                shareLinkHint={shareLinkHint}
                shareLinkNeedsCaution={shareLinkDetails?.needsCaution ?? false}
                onExportWorkspaces={exportWorkspaces}
                onImportWorkspaces={importWorkspaces}
                workspaceRevisions={getWorkspaceRevisions(workspaceRevisions, activeWorkspaceId)}
                onRestoreWorkspaceRevision={restoreWorkspaceRevision}
              />
            </Suspense>
          </div>

          {/* Divider */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize query editor and results panes"
            aria-valuemin={22}
            aria-valuemax={72}
            aria-valuenow={dividerY}
            aria-valuetext={`Query editor occupies ${dividerY} percent of the console height`}
            tabIndex={0}
            className="group relative h-4 bg-primary/[0.025] hover:bg-primary/15 focus:bg-primary/15 cursor-row-resize touch-none select-none flex items-center justify-center shrink-0 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/65"
            title="Drag up or down to resize. Use Arrow Up or Arrow Down when focused."
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setEditorShareFromPointer(event.clientY);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setEditorShareFromPointer(event.clientY);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={resizeDividerWithKey}
          >
            <span className="h-[3px] w-12 rounded-full bg-border group-hover:bg-primary/65 group-focus:bg-primary/65 transition-colors duration-150" aria-hidden="true" />
          </div>

          {/* Results pane */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t-[4px] border-t-primary bg-background shadow-[inset_0_1px_0_hsl(var(--background))]">
            <div className="px-5 py-3.5 border-b border-primary/25 bg-primary/[0.055] shrink-0 flex items-center gap-3">
              <span className="inline-block h-3.5 w-3.5 bg-primary translate-y-[-1px] shadow-[8px_0_0_hsl(var(--primary)/0.16)]" aria-hidden="true" />
              <span className="font-serif text-[20px] font-semibold tracking-tight text-foreground">Results ledger</span>
              <span className="text-[9px] font-mono uppercase tracking-[0.26em] text-muted-foreground/75">current execution record</span>
              {error && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-destructive font-mono">
                  <AlertTriangle className="h-3 w-3" /> {error}
                </span>
              )}
            </div>
            {result ? (
              <Suspense fallback={<div className="flex-1 p-4 text-xs font-mono text-muted-foreground">Loading result grid…</div>}>
                <ResultsTable columns={result.columns} rows={result.rows} />
              </Suspense>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
                <Rows3 className="h-8 w-8 opacity-30" />
                <p className="text-sm">
                  50,000 rows, one page at a time.
                </p>
                <p className="text-xs font-mono">50,000 orders · 120,000 line items · all in your browser</p>
              </div>
            )}
          </div>
        </div>

        <HistoryRail
          className="hidden lg:flex"
          entries={history}
          onRestore={restore}
          onTogglePin={togglePin}
          onDelete={removeHistoryEntry}
        />
      </div>
    </div>
  );
}
