/**
 * Ledger Light — SQL Query Runner
 * SQL input area. A plain textarea styled as an editor keeps the build free
 * of heavy dependencies; it supports tab indentation, Ctrl/Cmd+Enter to run,
 * and instant cursor feedback.
 * Design alignment: Ledger Light keeps keyboard knowledge close to the editor
 * in a compact, focused reference rather than competing with the query surface.
 * Searchable commands compress routine console actions into one quiet entry point.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Play, Loader2 } from "lucide-react";
import CommandPalette, { type CommandPaletteAction } from "@/components/CommandPalette";
import WorkspaceShelf from "@/components/WorkspaceShelf";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { QueryWorkspace, WorkspaceRevision } from "@/lib/preferences";
import type { ShareLinkMode } from "@/lib/shareLink";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  running: boolean;
  workspaces: QueryWorkspace[];
  activeWorkspaceId: string | null;
  workspaceName: string;
  onWorkspaceNameChange: (name: string) => void;
  workspaceLabel: string;
  onWorkspaceLabelChange: (label: string) => void;
  workspaceLabels: string[];
  workspaceSearch: string;
  onWorkspaceSearchChange: (search: string) => void;
  activeLabelFilters: string[];
  onActiveLabelFiltersChange: (labels: string[]) => void;
  onLoadWorkspace: (id: string) => void;
  onSaveWorkspace: () => void;
  onNewWorkspace: () => void;
  onDeleteWorkspace: () => void;
  isDuplicateWorkspaceName: boolean;
  readOnly: boolean;
  onShareQuery: () => void;
  shareLinkMode: ShareLinkMode;
  onShareLinkModeChange: (mode: ShareLinkMode) => void;
  onMakeEditableCopy: () => void;
  shareLinkHint: string | null;
  shareLinkNeedsCaution: boolean;
  onExportWorkspaces: () => void;
  onImportWorkspaces: (file: File) => void | Promise<void>;
  workspaceRevisions: WorkspaceRevision[];
  onRestoreWorkspaceRevision: (revision: WorkspaceRevision) => void;
}

export default function QueryEditor({
  value,
  onChange,
  onRun,
  running,
  workspaces,
  activeWorkspaceId,
  workspaceName,
  onWorkspaceNameChange,
  workspaceLabel,
  onWorkspaceLabelChange,
  workspaceLabels,
  workspaceSearch,
  onWorkspaceSearchChange,
  activeLabelFilters,
  onActiveLabelFiltersChange,
  onLoadWorkspace,
  onSaveWorkspace,
  onNewWorkspace,
  onDeleteWorkspace,
  isDuplicateWorkspaceName,
  readOnly,
  onShareQuery,
  shareLinkMode,
  onShareLinkModeChange,
  onMakeEditableCopy,
  shareLinkHint,
  shareLinkNeedsCaution,
  onExportWorkspaces,
  onImportWorkspaces,
  workspaceRevisions,
  onRestoreWorkspaceRevision,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onRun();
      }
      if (readOnly) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = value.slice(0, start) + "  " + value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + 2;
        });
      }
    };
    el.addEventListener("keydown", handleKey);
    return () => el.removeEventListener("keydown", handleKey);
  }, [value, onChange, onRun, readOnly]);

  const commandActions = useMemo<CommandPaletteAction[]>(() => [
    { id: "run", category: "Query", label: "Run current query", detail: "Execute the SQL in the editor.", keywords: "execute ctrl enter", disabled: running, run: onRun },
    { id: "focus", category: "Query", label: "Focus SQL editor", detail: "Place the cursor in the query editor.", keywords: "write query", run: () => ref.current?.focus() },
    { id: "shortcuts", category: "Help", label: "View keyboard shortcuts", detail: "Open the compact editor shortcut reference.", keywords: "help reference", run: () => setShortcutsOpen(true) },
    { id: "save", category: "Workspace", label: "Save workspace", detail: "Store the current named query in this browser.", keywords: "draft", disabled: readOnly || isDuplicateWorkspaceName || !workspaceName.trim(), run: onSaveWorkspace },
    { id: "new", category: "Workspace", label: "Start a new workspace", detail: "Prepare a fresh named draft from the current query.", keywords: "draft", disabled: readOnly, run: onNewWorkspace },
    { id: "share", category: "Share", label: "Copy read-only query link", detail: "Copy a shareable link for the current SQL.", keywords: "link clipboard", run: onShareQuery },
    ...(readOnly ? [{ id: "editable", category: "Workspace", label: "Make editable copy", detail: "Leave read-only mode and continue from this query.", keywords: "shared clone", run: onMakeEditableCopy }] : []),
  ], [isDuplicateWorkspaceName, onMakeEditableCopy, onNewWorkspace, onRun, onSaveWorkspace, onShareQuery, readOnly, running, workspaceName]);

  return (
    <div className="relative flex flex-col h-full">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        placeholder="-- Write a query, then press Ctrl/Cmd+Enter&#10;SELECT * FROM orders LIMIT 50;"
        className="flex-1 w-full resize-none bg-transparent text-[13.5px] font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/60 p-4 focus:outline-none"
        aria-label="SQL query input"
      />
      <WorkspaceShelf
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        workspaceName={workspaceName}
        onWorkspaceNameChange={onWorkspaceNameChange}
        workspaceLabel={workspaceLabel}
        onWorkspaceLabelChange={onWorkspaceLabelChange}
        workspaceLabels={workspaceLabels}
        workspaceSearch={workspaceSearch}
        onWorkspaceSearchChange={onWorkspaceSearchChange}
        activeLabelFilters={activeLabelFilters}
        onActiveLabelFiltersChange={onActiveLabelFiltersChange}
        onLoadWorkspace={onLoadWorkspace}
        onSaveWorkspace={onSaveWorkspace}
        onNewWorkspace={onNewWorkspace}
        onDeleteWorkspace={onDeleteWorkspace}
        isDuplicateName={isDuplicateWorkspaceName}
        readOnly={readOnly}
        onShareQuery={onShareQuery}
        shareLinkMode={shareLinkMode}
        onShareLinkModeChange={onShareLinkModeChange}
        onMakeEditableCopy={onMakeEditableCopy}
        shareLinkHint={shareLinkHint}
        shareLinkNeedsCaution={shareLinkNeedsCaution}
        onExportWorkspaces={onExportWorkspaces}
        onImportWorkspaces={onImportWorkspaces}
        workspaceRevisions={workspaceRevisions}
        onRestoreWorkspaceRevision={onRestoreWorkspaceRevision}
      />
      <div className="flex items-center justify-between px-4 py-2 border-t border-border/60 bg-card/60">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
          <span className="hidden sm:inline">Ctrl/Cmd + Enter to run · TAB indents</span>
          <CommandPalette actions={commandActions} />
          <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
            <DialogTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 px-1 py-0.5 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/60 rounded-sm" title="Open keyboard shortcut reference">
                <Keyboard className="h-3.5 w-3.5" aria-hidden="true" /> Shortcuts
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm gap-3 p-4 font-mono" aria-describedby="shortcut-reference-description">
              <DialogHeader className="gap-1 text-left">
                <DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
                <DialogDescription id="shortcut-reference-description" className="text-[11px] leading-relaxed">Editor and result-filter controls respond immediately to these keys.</DialogDescription>
              </DialogHeader>
              <dl className="divide-y divide-border/70 border-y border-border/70 text-[11px]">
                <div className="flex items-center justify-between gap-4 py-2"><dt>Run the current query</dt><dd><kbd className="rounded border border-border bg-muted px-1.5 py-0.5">Ctrl/Cmd</kbd> + <kbd className="rounded border border-border bg-muted px-1.5 py-0.5">Enter</kbd></dd></div>
                <div className="flex items-center justify-between gap-4 py-2"><dt>Indent at the editor cursor</dt><dd><kbd className="rounded border border-border bg-muted px-1.5 py-0.5">Tab</kbd></dd></div>
                <div className="flex items-center justify-between gap-4 py-2"><dt>Clear the focused result filter</dt><dd><kbd className="rounded border border-border bg-muted px-1.5 py-0.5">Escape</kbd></dd></div>
                <div className="flex items-center justify-between gap-4 py-2"><dt>Close this reference</dt><dd><kbd className="rounded border border-border bg-muted px-1.5 py-0.5">Escape</kbd></dd></div>
              </dl>
            </DialogContent>
          </Dialog>
        </div>
        <button
          onClick={() => onRun()}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-all duration-150 active:scale-[0.97]"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {running ? "Running" : "Run query"}
        </button>
      </div>
    </div>
  );
}
