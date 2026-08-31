/**
 * Ledger Light — command palette.
 * A compact action index for keyboard-led query work. Categories and recent
 * browser-local actions preserve orientation without competing with results.
 */

import { useEffect, useMemo, useState } from "react";
import { Command, Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { loadCommandPaletteRecents, recordCommandPaletteRecent, saveCommandPaletteRecents, type CommandPaletteRecentAction } from "@/lib/preferences";

export interface CommandPaletteAction {
  id: string;
  label: string;
  detail: string;
  category?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  actions: CommandPaletteAction[];
}

export default function CommandPalette({ actions }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentActions, setRecentActions] = useState<CommandPaletteRecentAction[]>(() => loadCommandPaletteRecents());

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const visibleActions = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    if (!key) return actions;
    return actions.filter((action) => `${action.label} ${action.detail} ${action.keywords ?? ""}`.toLocaleLowerCase().includes(key));
  }, [actions, query]);

  const orderedActions = useMemo(() => {
    if (query.trim()) return visibleActions;
    const recentIds = recentActions.map((entry) => entry.actionId);
    const recent = recentIds.map((id) => visibleActions.find((action) => action.id === id)).filter((action): action is CommandPaletteAction => Boolean(action));
    return [...recent, ...visibleActions.filter((action) => !recentIds.includes(action.id))];
  }, [query, recentActions, visibleActions]);

  const actionGroups = useMemo(() => {
    const groups = new Map<string, Array<{ action: CommandPaletteAction; index: number }>>();
    const recentIds = new Set(recentActions.map((entry) => entry.actionId));
    orderedActions.forEach((action, index) => {
      const category = !query.trim() && recentIds.has(action.id) ? "Recent" : action.category ?? "General";
      const entries = groups.get(category) ?? [];
      entries.push({ action, index });
      groups.set(category, entries);
    });
    return Array.from(groups.entries());
  }, [orderedActions, query, recentActions]);

  const enabledIndices = useMemo(() => orderedActions.flatMap((action, index) => action.disabled ? [] : [index]), [orderedActions]);

  useEffect(() => {
    setActiveIndex(enabledIndices[0] ?? 0);
  }, [open, query, enabledIndices]);

  useEffect(() => {
    saveCommandPaletteRecents(recentActions);
  }, [recentActions]);

  const chooseAction = (action: CommandPaletteAction) => {
    if (action.disabled) return;
    setRecentActions((entries) => recordCommandPaletteRecent(entries, action.id));
    setOpen(false);
    requestAnimationFrame(action.run);
  };

  const moveActiveAction = (direction: 1 | -1 | "first" | "last") => {
    if (enabledIndices.length === 0) return;
    if (direction === "first") { setActiveIndex(enabledIndices[0]); return; }
    if (direction === "last") { setActiveIndex(enabledIndices[enabledIndices.length - 1]); return; }
    const current = enabledIndices.indexOf(activeIndex);
    const next = current < 0 ? 0 : (current + direction + enabledIndices.length) % enabledIndices.length;
    setActiveIndex(enabledIndices[next]);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setQuery(""); }}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 px-1 py-0.5 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/60 rounded-sm" title="Open command palette (Ctrl/Cmd+K)" aria-keyshortcuts="Control+K Meta+K">
          <Command className="h-3.5 w-3.5" aria-hidden="true" /> Command
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md gap-3 p-4 font-mono" aria-describedby="command-palette-description">
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm"><Command className="h-4 w-4 text-primary" aria-hidden="true" /> Command palette</DialogTitle>
          <DialogDescription id="command-palette-description" className="text-[11px] leading-relaxed">Find a query or workspace action. Recent actions stay in this browser.</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <span className="sr-only">Search commands</span>
          <Keyboard className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); moveActiveAction(1); }
            if (event.key === "ArrowUp") { event.preventDefault(); moveActiveAction(-1); }
            if (event.key === "Home") { event.preventDefault(); moveActiveAction("first"); }
            if (event.key === "End") { event.preventDefault(); moveActiveAction("last"); }
            if (event.key === "Enter") { event.preventDefault(); const action = orderedActions[activeIndex]; if (action) chooseAction(action); }
          }} placeholder="Search actions" className="w-full border border-border bg-transparent py-2 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/65 outline-none focus:border-primary focus:ring-1 focus:ring-primary/40" aria-controls="command-palette-actions" aria-activedescendant={orderedActions[activeIndex] ? `command-action-${orderedActions[activeIndex].id}` : undefined} />
        </label>
        <div id="command-palette-actions" className="max-h-[19rem] overflow-y-auto border-y border-border/70 py-1" role="listbox" aria-label="Available commands">
          {orderedActions.length > 0 ? actionGroups.map(([category, entries]) => <div key={category} role="group" aria-label={`${category} commands`} className="py-1 first:pt-0">
            <p className="px-2 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{category}</p>
            {entries.map(({ action, index }) => <button id={`command-action-${action.id}`} key={action.id} type="button" role="option" aria-selected={activeIndex === index} disabled={action.disabled} onClick={() => chooseAction(action)} onMouseMove={() => !action.disabled && setActiveIndex(index)} className={`flex w-full items-start justify-between gap-4 px-2 py-2 text-left transition-colors duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${activeIndex === index ? "bg-primary/[0.07]" : "hover:bg-primary/[0.045]"}`}>
              <span><span className="block text-[12px] text-foreground">{action.label}</span><span className="block pt-0.5 text-[10px] leading-relaxed text-muted-foreground">{action.detail}</span></span>
              {action.disabled && <span className="shrink-0 pt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">Unavailable</span>}
            </button>)}
          </div>) : <p className="px-2 py-5 text-center text-[11px] text-muted-foreground">No matching command.</p>}
        </div>
        <p className="text-[10px] text-muted-foreground"><kbd className="rounded border border-border bg-muted px-1 py-0.5">Ctrl/Cmd</kbd> + <kbd className="rounded border border-border bg-muted px-1 py-0.5">K</kbd> opens; <kbd className="rounded border border-border bg-muted px-1 py-0.5">↑</kbd>/<kbd className="rounded border border-border bg-muted px-1 py-0.5">↓</kbd> selects; <kbd className="rounded border border-border bg-muted px-1 py-0.5">Enter</kbd> runs.</p>
      </DialogContent>
    </Dialog>
  );
}
