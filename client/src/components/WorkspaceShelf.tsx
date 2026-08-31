/**
 * Ledger Light — workspace shelf.
 * A compact browser-local filing strip for drafts, portable workspaces, shared
 * links, and deliberate revision recovery without server-side state.
 * Design alignment: Ledger Light uses labeled filing cues and low-chrome,
 * keyboard-reachable controls to keep a dense console readable. Search works
 * as a filing index across both workspace names and optional labels.
 */

import { useMemo, useRef } from "react";
import { Bookmark, CopyPlus, Download, History, Link2, Plus, Save, Search, Tag, Trash2, Upload, X } from "lucide-react";
import { filterWorkspacesBySearch, listWorkspaceLabels, type QueryWorkspace, type WorkspaceRevision } from "@/lib/preferences";
import type { ShareLinkMode } from "@/lib/shareLink";

interface Props {
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
  isDuplicateName: boolean;
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

function ShareModeControl({ value, onChange }: { value: ShareLinkMode; onChange: (mode: ShareLinkMode) => void }) {
  return (
    <label className="inline-flex items-center gap-1 border-l border-border/60 px-2 py-1 text-[10px] font-mono text-muted-foreground">
      Link
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ShareLinkMode)}
        className="max-w-[5.4rem] bg-transparent text-[10px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
        aria-label="Share link format"
      >
        <option value="standard">Standard</option>
        <option value="compact">Compact</option>
      </select>
    </label>
  );
}

export default function WorkspaceShelf({
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
  isDuplicateName,
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
  const importRef = useRef<HTMLInputElement>(null);
  const hintClass = shareLinkNeedsCaution ? "text-amber-700" : "text-muted-foreground";
  const searchedWorkspaces = useMemo(() => filterWorkspacesBySearch(workspaces, workspaceSearch), [workspaces, workspaceSearch]);
  const visibleWorkspaces = useMemo(() => activeLabelFilters.length === 0 ? searchedWorkspaces : searchedWorkspaces.filter((workspace) => Boolean(workspace.label && activeLabelFilters.includes(workspace.label))), [activeLabelFilters, searchedWorkspaces]);
  const visibleLabels = useMemo(() => listWorkspaceLabels(visibleWorkspaces), [visibleWorkspaces]);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeIsHidden = Boolean(activeWorkspace && !visibleWorkspaces.some((workspace) => workspace.id === activeWorkspace.id));
  const toggleLabelFilter = (label: string) => onActiveLabelFiltersChange(activeLabelFilters.includes(label) ? activeLabelFilters.filter((entry) => entry !== label) : [...activeLabelFilters, label]);

  if (readOnly) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-1.5 border-t border-border/40 bg-secondary/25">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Shared query · read only</span>
        <ShareModeControl value={shareLinkMode} onChange={onShareLinkModeChange} />
        <button type="button" onClick={onShareQuery} className="inline-flex items-center gap-1 border-l border-border/60 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors duration-150 active:scale-[0.97]" title="Copy this read-only query link" aria-describedby={shareLinkHint ? "share-link-help" : undefined}>
          <Link2 className="h-3 w-3" aria-hidden="true" /> Copy link
        </button>
        {shareLinkHint && <output id="share-link-help" className={`text-[10px] font-mono ${hintClass}`}>{shareLinkHint}</output>}
        <button type="button" onClick={onMakeEditableCopy} className="inline-flex items-center gap-1 border-l border-border/60 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors duration-150 active:scale-[0.97]">
          <CopyPlus className="h-3 w-3" aria-hidden="true" /> Make editable copy
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-1.5 border-t border-border/25 bg-transparent">
      <Bookmark className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0" aria-hidden="true" />
      <label htmlFor="workspace-select" className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">Workspace</label>
      <span className="relative inline-flex items-center border-b border-border text-muted-foreground focus-within:border-primary">
        <Search className="pointer-events-none ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
        <label htmlFor="workspace-search" className="sr-only">Search workspace names and labels</label>
        <input id="workspace-search" value={workspaceSearch} onChange={(event) => onWorkspaceSearchChange(event.target.value)} placeholder="Find" className="w-[4.5rem] bg-transparent px-1 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/65 focus:outline-none" />
      </span>
      {workspaceLabels.length > 0 && <div className="flex max-w-full items-center gap-1" role="group" aria-label="Workspace label filters">
        {workspaceLabels.map((label) => {
          const selected = activeLabelFilters.includes(label);
          return <span key={label} className={`inline-flex items-center border text-[9px] font-mono transition-colors duration-150 ${selected ? "border-primary/60 bg-primary/[0.08] text-primary" : "border-border/60 text-muted-foreground"}`}>
            <button type="button" onClick={() => toggleLabelFilter(label)} aria-pressed={selected} className="px-1.5 py-0.5 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60" title={`${selected ? "Remove" : "Add"} ${label} label filter`}>{label}</button>
            {selected && <button type="button" onClick={() => toggleLabelFilter(label)} className="border-l border-primary/30 px-1 py-0.5 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60" title={`Remove ${label} label filter`} aria-label={`Remove ${label} label filter`}><X className="h-2.5 w-2.5" aria-hidden="true" /></button>}
          </span>;
        })}
      </div>}
      <select id="workspace-select" value={activeWorkspaceId ?? ""} onChange={(event) => { if (event.target.value) onLoadWorkspace(event.target.value); }} className="min-w-[8.5rem] max-w-[12rem] bg-transparent border-0 border-b border-border px-1 py-1 text-[11px] font-mono text-foreground focus:outline-none focus:border-primary" aria-label="Saved query workspace">
        <option value="">Unsaved query</option>
        {activeIsHidden && activeWorkspace && <option value={activeWorkspace.id}>{activeWorkspace.name} · current</option>}
        {visibleLabels.length > 0 ? (
          <>
            {visibleWorkspaces.filter((workspace) => !workspace.label).length > 0 && <optgroup label="Unlabeled">{visibleWorkspaces.filter((workspace) => !workspace.label).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</optgroup>}
            {visibleLabels.map((label) => <optgroup key={label} label={label}>{visibleWorkspaces.filter((workspace) => workspace.label === label).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</optgroup>)}
          </>
        ) : visibleWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
      {(workspaceSearch.trim() || activeLabelFilters.length > 0) && <output className="text-[10px] font-mono text-muted-foreground">{visibleWorkspaces.length} found</output>}
      <label htmlFor="workspace-name" className="sr-only">Workspace name</label>
      <input id="workspace-name" value={workspaceName} onChange={(event) => onWorkspaceNameChange(event.target.value)} placeholder="Workspace name" className="min-w-[7rem] flex-1 bg-transparent border-b border-border px-1 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/65 focus:outline-none focus:border-primary" aria-describedby={isDuplicateName ? "workspace-help workspace-name-error" : "workspace-help"} aria-invalid={isDuplicateName} />
      <span className="inline-flex items-center border-b border-border text-muted-foreground focus-within:border-primary">
        <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
        <label htmlFor="workspace-label" className="sr-only">Workspace label</label>
        <input id="workspace-label" value={workspaceLabel} onChange={(event) => onWorkspaceLabelChange(event.target.value)} placeholder="Label" maxLength={32} list="workspace-labels" className="w-[5.8rem] bg-transparent px-1 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/65 focus:outline-none" aria-describedby="workspace-label-help" />
      </span>
      <datalist id="workspace-labels">{workspaceLabels.map((label) => <option key={label} value={label} />)}</datalist>
      <span id="workspace-help" className="sr-only">Save stores this SQL locally. Editing the name then saving renames the active workspace.</span>
      <span id="workspace-label-help" className="sr-only">Optional label used to group saved workspaces in the selector.</span>
      {isDuplicateName && <span id="workspace-name-error" role="alert" className="text-[10px] font-mono text-destructive">A workspace already uses this name.</span>}
      <button type="button" onClick={onSaveWorkspace} disabled={isDuplicateName || !workspaceName.trim()} title={activeWorkspaceId ? "Save query changes and workspace name" : "Save this query as a workspace"} className="inline-flex items-center gap-1 border-l border-border/45 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 disabled:opacity-35 disabled:pointer-events-none transition-colors duration-150 active:scale-[0.97]"><Save className="h-3 w-3" aria-hidden="true" /> Save</button>
      <button type="button" onClick={onNewWorkspace} title="Prepare a new named workspace from the current query" className="inline-flex items-center gap-1 border-l border-border/45 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors duration-150 active:scale-[0.97]"><Plus className="h-3 w-3" aria-hidden="true" /> New</button>
      {activeWorkspaceId && workspaceRevisions.length > 0 && (
        <label className="inline-flex items-center gap-1 border-l border-border/60 px-2 py-1 text-[10px] font-mono text-muted-foreground">
          <History className="h-3 w-3" aria-hidden="true" /> Revision
          <select value="" onChange={(event) => { const revision = workspaceRevisions.find((entry) => entry.revisionId === event.target.value); if (revision) onRestoreWorkspaceRevision(revision); }} className="max-w-[8.5rem] bg-transparent text-[10px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60" aria-label="Restore an earlier workspace revision">
            <option value="">Restore…</option>
            {workspaceRevisions.map((revision, index) => <option key={revision.revisionId} value={revision.revisionId}>v{workspaceRevisions.length - index} · {new Date(revision.createdAt).toLocaleString()}</option>)}
          </select>
        </label>
      )}
      <ShareModeControl value={shareLinkMode} onChange={onShareLinkModeChange} />
      <button type="button" onClick={onShareQuery} title="Copy a read-only link for this SQL draft" aria-describedby={shareLinkHint ? "share-link-help" : undefined} className="inline-flex items-center gap-1 border-l border-border/45 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors duration-150 active:scale-[0.97]"><Link2 className="h-3 w-3" aria-hidden="true" /> Share</button>
      {shareLinkHint && <output id="share-link-help" className={`text-[10px] font-mono ${hintClass}`}>{shareLinkHint}</output>}
      <div className="inline-flex items-center border-l border-border/45">
        <button type="button" onClick={onExportWorkspaces} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors duration-150 active:scale-[0.97]" title="Download all saved workspaces as a JSON file"><Download className="h-3 w-3" aria-hidden="true" /> Export</button>
        <input ref={importRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import Queryline workspace JSON file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportWorkspaces(file); event.target.value = ""; }} />
        <button type="button" onClick={() => importRef.current?.click()} className="inline-flex items-center gap-1 border-l border-border/45 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors duration-150 active:scale-[0.97]" title="Merge saved workspaces from a Queryline JSON file"><Upload className="h-3 w-3" aria-hidden="true" /> Import</button>
      </div>
      <button type="button" onClick={onDeleteWorkspace} disabled={!activeWorkspaceId} className="inline-flex items-center justify-center border-l border-border/60 p-1 text-muted-foreground hover:text-destructive focus:outline-none focus:ring-1 focus:ring-primary/60 disabled:opacity-35 disabled:pointer-events-none transition-colors duration-150 active:scale-[0.97]" title="Delete the active workspace" aria-label="Delete the active workspace"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </div>
  );
}
