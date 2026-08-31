/**
 * Ledger Light — browser-local Queryline preferences.
 *
 * Only non-sensitive UI data is retained locally. Stored values are validated
 * before use so stale or edited browser state cannot disrupt the console.
 */

import type { ColumnFilters } from "./tableFilter";

export interface QueryHistoryEntry {
  id: number;
  label: string;
  sql: string;
  elapsedMs: number;
  rowCount: number;
  ts: string;
  pinned: boolean;
}

export const PAGE_SIZES = [25, 50, 100, 500] as const;
export const DEFAULT_PAGE_SIZE = 50;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface QueryWorkspace {
  id: string;
  name: string;
  label?: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceRevision {
  workspaceId: string;
  revisionId: string;
  name: string;
  label?: string;
  sql: string;
  createdAt: number;
}

export type WorkspaceRevisionMap = Record<string, WorkspaceRevision[]>;

const HISTORY_KEY = "queryline.history.v1";
const PAGE_SIZE_KEY = "queryline.page-size.v1";
const WORKSPACES_KEY = "queryline.workspaces.v1";
const FILTER_PRESETS_KEY = "queryline.filter-presets.v1";
const WORKSPACE_REVISIONS_KEY = "queryline.workspace-revisions.v1";
const FILTER_PRESET_IMPORT_ACTIVITY_KEY = "queryline.filter-preset-import-activity.v1";
const COMMAND_PALETTE_RECENTS_KEY = "queryline.command-palette-recents.v1";
const MAX_HISTORY = 50;
const MAX_WORKSPACES = 25;
const MAX_FILTER_PRESETS = 20;
const MAX_FILTER_PRESET_IMPORT_ACTIVITIES = 6;
const MAX_COMMAND_PALETTE_RECENTS = 6;
export const MAX_WORKSPACE_REVISIONS = 12;
export const DEFAULT_FILTER_PRESET_FOLDER = "General";

export function workspaceNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeWorkspaceLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 32);
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isHistoryEntry(value: unknown): value is QueryHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "number" && Number.isSafeInteger(entry.id) && entry.id > 0 &&
    typeof entry.label === "string" && typeof entry.sql === "string" && entry.sql.length > 0 &&
    typeof entry.elapsedMs === "number" && Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= 0 &&
    typeof entry.rowCount === "number" && Number.isSafeInteger(entry.rowCount) && entry.rowCount >= 0 &&
    typeof entry.ts === "string" && (entry.pinned === undefined || typeof entry.pinned === "boolean");
}

function normalizeHistoryEntry(entry: QueryHistoryEntry): QueryHistoryEntry {
  return { ...entry, pinned: entry.pinned === true };
}

export function sortPinnedFirst(entries: QueryHistoryEntry[]): QueryHistoryEntry[] {
  return [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function parseHistory(value: string | null): QueryHistoryEntry[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? sortPinnedFirst(parsed.filter(isHistoryEntry).map(normalizeHistoryEntry)).slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function loadHistory(): QueryHistoryEntry[] {
  try { return parseHistory(storage()?.getItem(HISTORY_KEY) ?? null); } catch { return []; }
}

export function saveHistory(entries: QueryHistoryEntry[]): void {
  try { storage()?.setItem(HISTORY_KEY, JSON.stringify(sortPinnedFirst(entries.filter(isHistoryEntry).map(normalizeHistoryEntry)).slice(0, MAX_HISTORY))); } catch { /* local convenience only */ }
}

export function parsePageSize(value: string | null): PageSize {
  const candidate = Number(value);
  return PAGE_SIZES.includes(candidate as PageSize) ? candidate as PageSize : DEFAULT_PAGE_SIZE;
}

export function loadPageSize(): PageSize {
  try { return parsePageSize(storage()?.getItem(PAGE_SIZE_KEY) ?? null); } catch { return DEFAULT_PAGE_SIZE; }
}

export function savePageSize(pageSize: PageSize): void {
  if (!PAGE_SIZES.includes(pageSize)) return;
  try { storage()?.setItem(PAGE_SIZE_KEY, String(pageSize)); } catch { /* local convenience only */ }
}

export function toggleHistoryPin(entries: QueryHistoryEntry[], id: number): QueryHistoryEntry[] {
  return sortPinnedFirst(entries.map((entry) => entry.id === id ? { ...entry, pinned: !entry.pinned } : entry));
}

export function deleteHistoryEntry(entries: QueryHistoryEntry[], id: number): QueryHistoryEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

function isWorkspace(value: unknown): value is QueryWorkspace {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Record<string, unknown>;
  return typeof workspace.id === "string" && workspace.id.length > 0 &&
    typeof workspace.name === "string" && workspace.name.trim().length > 0 && workspace.name.length <= 80 &&
    (workspace.label === undefined || typeof workspace.label === "string") &&
    typeof workspace.sql === "string" && workspace.sql.trim().length > 0 &&
    typeof workspace.createdAt === "number" && Number.isFinite(workspace.createdAt) &&
    typeof workspace.updatedAt === "number" && Number.isFinite(workspace.updatedAt);
}

function normalizeWorkspace(workspace: QueryWorkspace): QueryWorkspace {
  return { ...workspace, name: workspace.name.trim().slice(0, 80), label: normalizeWorkspaceLabel(workspace.label), sql: workspace.sql.trim() };
}

function sortWorkspaces(entries: QueryWorkspace[]): QueryWorkspace[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

function uniqueWorkspaceNames(entries: QueryWorkspace[]): QueryWorkspace[] {
  const seen = new Set<string>();
  return sortWorkspaces(entries).filter((workspace) => {
    const key = workspaceNameKey(workspace.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseWorkspaces(value: string | null): QueryWorkspace[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? uniqueWorkspaceNames(parsed.filter(isWorkspace).map(normalizeWorkspace)).slice(0, MAX_WORKSPACES) : [];
  } catch {
    return [];
  }
}

export function loadWorkspaces(): QueryWorkspace[] {
  try { return parseWorkspaces(storage()?.getItem(WORKSPACES_KEY) ?? null); } catch { return []; }
}

export function saveWorkspaces(entries: QueryWorkspace[]): void {
  try { storage()?.setItem(WORKSPACES_KEY, JSON.stringify(uniqueWorkspaceNames(entries.filter(isWorkspace).map(normalizeWorkspace)).slice(0, MAX_WORKSPACES))); } catch { /* local convenience only */ }
}

export function findDuplicateWorkspace(entries: QueryWorkspace[], name: string, exceptId: string | null = null): QueryWorkspace | undefined {
  const key = workspaceNameKey(name);
  return key ? entries.find((workspace) => workspace.id !== exceptId && workspaceNameKey(workspace.name) === key) : undefined;
}

export function upsertWorkspace(entries: QueryWorkspace[], workspace: QueryWorkspace): QueryWorkspace[] {
  if (!isWorkspace(workspace) || findDuplicateWorkspace(entries, workspace.name, workspace.id)) return entries;
  return uniqueWorkspaceNames([normalizeWorkspace(workspace), ...entries.filter((entry) => entry.id !== workspace.id)]).slice(0, MAX_WORKSPACES);
}

export function deleteWorkspace(entries: QueryWorkspace[], id: string): QueryWorkspace[] {
  return entries.filter((workspace) => workspace.id !== id);
}

export function listWorkspaceLabels(entries: QueryWorkspace[]): string[] {
  return Array.from(new Set(entries.map((workspace) => normalizeWorkspaceLabel(workspace.label)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function filterWorkspacesBySearch(entries: QueryWorkspace[], query: string): QueryWorkspace[] {
  const key = workspaceNameKey(query);
  if (!key) return entries;
  return entries.filter((workspace) => workspaceNameKey(workspace.name).includes(key) || workspaceNameKey(normalizeWorkspaceLabel(workspace.label)).includes(key));
}

function isWorkspaceRevision(value: unknown): value is WorkspaceRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as Record<string, unknown>;
  return typeof revision.workspaceId === "string" && revision.workspaceId.length > 0 &&
    typeof revision.revisionId === "string" && revision.revisionId.length > 0 &&
    typeof revision.name === "string" && revision.name.trim().length > 0 && revision.name.length <= 80 &&
    (revision.label === undefined || typeof revision.label === "string") &&
    typeof revision.sql === "string" && revision.sql.trim().length > 0 &&
    typeof revision.createdAt === "number" && Number.isFinite(revision.createdAt);
}

function normalizeWorkspaceRevision(revision: WorkspaceRevision): WorkspaceRevision {
  return { ...revision, name: revision.name.trim().slice(0, 80), label: normalizeWorkspaceLabel(revision.label), sql: revision.sql.trim() };
}

function normalizeWorkspaceRevisionMap(value: unknown): WorkspaceRevisionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([workspaceId, revisions]) => workspaceId.length > 0 && Array.isArray(revisions))
    .map(([workspaceId, revisions]) => [workspaceId, (revisions as unknown[])
      .filter(isWorkspaceRevision).map(normalizeWorkspaceRevision)
      .filter((revision) => revision.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_WORKSPACE_REVISIONS)])
    .filter(([, revisions]) => revisions.length > 0)) as WorkspaceRevisionMap;
}

export function parseWorkspaceRevisions(value: string | null): WorkspaceRevisionMap {
  if (!value) return {};
  try { return normalizeWorkspaceRevisionMap(JSON.parse(value)); } catch { return {}; }
}

export function loadWorkspaceRevisions(): WorkspaceRevisionMap {
  try { return parseWorkspaceRevisions(storage()?.getItem(WORKSPACE_REVISIONS_KEY) ?? null); } catch { return {}; }
}

export function saveWorkspaceRevisions(entries: WorkspaceRevisionMap): void {
  try { storage()?.setItem(WORKSPACE_REVISIONS_KEY, JSON.stringify(normalizeWorkspaceRevisionMap(entries))); } catch { /* local convenience only */ }
}

export function getWorkspaceRevisions(entries: WorkspaceRevisionMap, workspaceId: string | null): WorkspaceRevision[] {
  return workspaceId ? normalizeWorkspaceRevisionMap(entries)[workspaceId] ?? [] : [];
}

export function recordWorkspaceRevision(entries: WorkspaceRevisionMap, workspace: QueryWorkspace, recordedAt = Date.now()): WorkspaceRevisionMap {
  if (!isWorkspace(workspace)) return entries;
  const normalized = normalizeWorkspaceRevisionMap(entries);
  const prior = normalized[workspace.id] ?? [];
  const name = workspace.name.trim();
  const sql = workspace.sql.trim();
  if (prior[0]?.name === name && prior[0]?.sql === sql) return normalized;
  const revision: WorkspaceRevision = { workspaceId: workspace.id, revisionId: `${workspace.id}-${recordedAt}-${prior.length}`, name, label: normalizeWorkspaceLabel(workspace.label), sql, createdAt: recordedAt };
  return { ...normalized, [workspace.id]: [revision, ...prior].slice(0, MAX_WORKSPACE_REVISIONS) };
}

export function deleteWorkspaceRevisions(entries: WorkspaceRevisionMap, workspaceId: string): WorkspaceRevisionMap {
  const normalized = normalizeWorkspaceRevisionMap(entries);
  const { [workspaceId]: _removed, ...remaining } = normalized;
  return remaining;
}

export interface WorkspaceArchive {
  format: "queryline-workspaces";
  version: 1;
  exportedAt: string;
  workspaces: QueryWorkspace[];
}

export interface WorkspaceImportResult {
  workspaces: QueryWorkspace[];
  imported: number;
  skipped: number;
}

function createImportedWorkspaceId(existingIds: Set<string>, sourceId: string): string {
  let suffix = 1;
  let id = `${sourceId}-imported`;
  while (existingIds.has(id)) { suffix += 1; id = `${sourceId}-imported-${suffix}`; }
  return id;
}

export function serializeWorkspaceArchive(entries: QueryWorkspace[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ format: "queryline-workspaces", version: 1, exportedAt, workspaces: parseWorkspaces(JSON.stringify(entries)) } satisfies WorkspaceArchive, null, 2);
}

export function parseWorkspaceArchive(value: string | null): QueryWorkspace[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const archive = parsed as Record<string, unknown>;
    return archive.format === "queryline-workspaces" && archive.version === 1 && Array.isArray(archive.workspaces) ? parseWorkspaces(JSON.stringify(archive.workspaces)) : null;
  } catch {
    return null;
  }
}

export function mergeImportedWorkspaces(existing: QueryWorkspace[], incoming: QueryWorkspace[]): WorkspaceImportResult {
  const next = uniqueWorkspaceNames(existing.filter(isWorkspace).map(normalizeWorkspace));
  const names = new Set(next.map((workspace) => workspaceNameKey(workspace.name)));
  const ids = new Set(next.map((workspace) => workspace.id));
  let imported = 0;
  let skipped = 0;
  for (const candidate of incoming.filter(isWorkspace).map(normalizeWorkspace)) {
    if (next.length >= MAX_WORKSPACES || names.has(workspaceNameKey(candidate.name))) { skipped += 1; continue; }
    const id = ids.has(candidate.id) ? createImportedWorkspaceId(ids, candidate.id) : candidate.id;
    next.push({ ...candidate, id });
    names.add(workspaceNameKey(candidate.name));
    ids.add(id);
    imported += 1;
  }
  return { workspaces: sortWorkspaces(next).slice(0, MAX_WORKSPACES), imported, skipped };
}

export interface ResultFilterPreset {
  id: string;
  name: string;
  folder?: string;
  filter: string;
  columnFilters: ColumnFilters;
  createdAt: number;
  updatedAt: number;
}

export interface FilterPresetArchive {
  format: "queryline-filter-presets";
  version: 1;
  exportedAt: string;
  presets: ResultFilterPreset[];
}

export interface FilterPresetImportResult {
  presets: ResultFilterPreset[];
  imported: number;
  skipped: number;
}

export interface FilterPresetImportPreview extends FilterPresetImportResult {
  importablePresets: ResultFilterPreset[];
  skippedPresets: ResultFilterPreset[];
}

export interface FilterPresetImportUndoResult {
  presets: ResultFilterPreset[];
  removed: number;
  protected: number;
}

export interface FilterPresetImportActivity {
  id: string;
  fileName: string;
  importedPresets: ResultFilterPreset[];
  imported: number;
  skipped: number;
  createdAt: number;
  undone: boolean;
}

export interface CommandPaletteRecentAction {
  actionId: string;
  usedAt: number;
}

function normalizeColumnFilters(value: unknown): ColumnFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([index, term]) => Number.isSafeInteger(Number(index)) && Number(index) >= 0 && typeof term === "string" && term.trim().length > 0 && term.length <= 120)
    .map(([index, term]) => [Number(index), (term as string).trim()])) as ColumnFilters;
}

function normalizePresetFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_FILTER_PRESET_FOLDER;
  const folder = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return folder || DEFAULT_FILTER_PRESET_FOLDER;
}

function filterPresetKey(preset: Pick<ResultFilterPreset, "name" | "folder">): string {
  return `${workspaceNameKey(normalizePresetFolder(preset.folder))}\u0000${workspaceNameKey(preset.name)}`;
}

function isFilterPreset(value: unknown): value is ResultFilterPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Record<string, unknown>;
  return typeof preset.id === "string" && preset.id.length > 0 &&
    typeof preset.name === "string" && preset.name.trim().length > 0 && preset.name.length <= 60 &&
    (preset.folder === undefined || typeof preset.folder === "string") &&
    typeof preset.filter === "string" && preset.filter.length <= 250 &&
    typeof preset.createdAt === "number" && Number.isFinite(preset.createdAt) &&
    typeof preset.updatedAt === "number" && Number.isFinite(preset.updatedAt) &&
    typeof preset.columnFilters === "object" && !Array.isArray(preset.columnFilters);
}

function normalizeFilterPreset(preset: ResultFilterPreset): ResultFilterPreset {
  return { ...preset, name: preset.name.trim().slice(0, 60), folder: normalizePresetFolder(preset.folder), filter: preset.filter.trim().slice(0, 250), columnFilters: normalizeColumnFilters(preset.columnFilters) };
}

function sortFilterPresets(entries: ResultFilterPreset[]): ResultFilterPreset[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

function uniqueFilterPresetNames(entries: ResultFilterPreset[]): ResultFilterPreset[] {
  const seen = new Set<string>();
  return sortFilterPresets(entries).filter((preset) => {
    const key = filterPresetKey(preset);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseFilterPresets(value: string | null): ResultFilterPreset[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? uniqueFilterPresetNames(parsed.filter(isFilterPreset).map(normalizeFilterPreset)).slice(0, MAX_FILTER_PRESETS) : [];
  } catch {
    return [];
  }
}

export function loadFilterPresets(): ResultFilterPreset[] {
  try { return parseFilterPresets(storage()?.getItem(FILTER_PRESETS_KEY) ?? null); } catch { return []; }
}

export function saveFilterPresets(entries: ResultFilterPreset[]): void {
  try { storage()?.setItem(FILTER_PRESETS_KEY, JSON.stringify(uniqueFilterPresetNames(entries.filter(isFilterPreset).map(normalizeFilterPreset)).slice(0, MAX_FILTER_PRESETS))); } catch { /* local convenience only */ }
}

export function upsertFilterPreset(entries: ResultFilterPreset[], preset: ResultFilterPreset): ResultFilterPreset[] {
  if (!isFilterPreset(preset)) return entries;
  const duplicate = entries.find((entry) => entry.id !== preset.id && filterPresetKey(entry) === filterPresetKey(preset));
  if (duplicate) return entries;
  return uniqueFilterPresetNames([normalizeFilterPreset(preset), ...entries.filter((entry) => entry.id !== preset.id)]).slice(0, MAX_FILTER_PRESETS);
}

export function deleteFilterPreset(entries: ResultFilterPreset[], id: string): ResultFilterPreset[] {
  return entries.filter((preset) => preset.id !== id);
}

function createImportedPresetId(existingIds: Set<string>, sourceId: string): string {
  let suffix = 1;
  let id = `${sourceId}-imported`;
  while (existingIds.has(id)) { suffix += 1; id = `${sourceId}-imported-${suffix}`; }
  return id;
}

export function serializeFilterPresetArchive(entries: ResultFilterPreset[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ format: "queryline-filter-presets", version: 1, exportedAt, presets: parseFilterPresets(JSON.stringify(entries)) } satisfies FilterPresetArchive, null, 2);
}

export function parseFilterPresetArchive(value: string | null): ResultFilterPreset[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const archive = parsed as Record<string, unknown>;
    return archive.format === "queryline-filter-presets" && archive.version === 1 && Array.isArray(archive.presets) ? parseFilterPresets(JSON.stringify(archive.presets)) : null;
  } catch {
    return null;
  }
}

export function previewFilterPresetImport(existing: ResultFilterPreset[], incoming: ResultFilterPreset[]): FilterPresetImportPreview {
  const next = uniqueFilterPresetNames(existing.filter(isFilterPreset).map(normalizeFilterPreset));
  const keys = new Set(next.map(filterPresetKey));
  const ids = new Set(next.map((preset) => preset.id));
  const importablePresets: ResultFilterPreset[] = [];
  const skippedPresets: ResultFilterPreset[] = [];
  let imported = 0;
  let skipped = 0;
  for (const candidate of incoming.filter(isFilterPreset).map(normalizeFilterPreset)) {
    if (next.length >= MAX_FILTER_PRESETS || keys.has(filterPresetKey(candidate))) {
      skippedPresets.push(candidate);
      skipped += 1;
      continue;
    }
    const id = ids.has(candidate.id) ? createImportedPresetId(ids, candidate.id) : candidate.id;
    const importedPreset = { ...candidate, id };
    next.push(importedPreset);
    importablePresets.push(importedPreset);
    keys.add(filterPresetKey(candidate));
    ids.add(id);
    imported += 1;
  }
  return { presets: sortFilterPresets(next).slice(0, MAX_FILTER_PRESETS), imported, skipped, importablePresets, skippedPresets };
}

export function mergeImportedFilterPresets(existing: ResultFilterPreset[], incoming: ResultFilterPreset[]): FilterPresetImportResult {
  const preview = previewFilterPresetImport(existing, incoming);
  return { presets: preview.presets, imported: preview.imported, skipped: preview.skipped };
}

function isUnchangedImportedPreset(current: ResultFilterPreset, imported: ResultFilterPreset): boolean {
  return current.id === imported.id &&
    current.name === imported.name &&
    normalizePresetFolder(current.folder) === normalizePresetFolder(imported.folder) &&
    current.filter === imported.filter &&
    current.createdAt === imported.createdAt &&
    current.updatedAt === imported.updatedAt &&
    JSON.stringify(normalizeColumnFilters(current.columnFilters)) === JSON.stringify(normalizeColumnFilters(imported.columnFilters));
}

/** Removes only the untouched presets created by one confirmed import. */
export function undoImportedFilterPresets(entries: ResultFilterPreset[], importedPresets: ResultFilterPreset[]): FilterPresetImportUndoResult {
  const snapshots = new Map(importedPresets.filter(isFilterPreset).map((preset) => [preset.id, normalizeFilterPreset(preset)]));
  let removed = 0;
  let protectedCount = 0;
  const presets = entries.filter((preset) => {
    const snapshot = snapshots.get(preset.id);
    if (!snapshot) return true;
    if (isUnchangedImportedPreset(preset, snapshot)) {
      removed += 1;
      return false;
    }
    protectedCount += 1;
    return true;
  });
  return { presets, removed, protected: protectedCount };
}

function isFilterPresetImportActivity(value: unknown): value is FilterPresetImportActivity {
  if (!value || typeof value !== "object") return false;
  const activity = value as Record<string, unknown>;
  return typeof activity.id === "string" && activity.id.length > 0 &&
    typeof activity.fileName === "string" && activity.fileName.length <= 180 &&
    Array.isArray(activity.importedPresets) &&
    typeof activity.imported === "number" && Number.isSafeInteger(activity.imported) && activity.imported >= 0 &&
    typeof activity.skipped === "number" && Number.isSafeInteger(activity.skipped) && activity.skipped >= 0 &&
    typeof activity.createdAt === "number" && Number.isFinite(activity.createdAt) &&
    typeof activity.undone === "boolean";
}

function normalizeFilterPresetImportActivity(activity: FilterPresetImportActivity): FilterPresetImportActivity {
  const importedPresets = parseFilterPresets(JSON.stringify(activity.importedPresets));
  return {
    ...activity,
    fileName: activity.fileName.trim().slice(0, 180) || "Imported preset archive",
    importedPresets,
    imported: Math.min(activity.imported, importedPresets.length),
  };
}

export function parseFilterPresetImportActivities(value: string | null): FilterPresetImportActivity[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter(isFilterPresetImportActivity).map(normalizeFilterPresetImportActivity)
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((activity) => activity.importedPresets.length > 0 && !seen.has(activity.id) && Boolean(seen.add(activity.id)))
      .slice(0, MAX_FILTER_PRESET_IMPORT_ACTIVITIES);
  } catch {
    return [];
  }
}

export function loadFilterPresetImportActivities(): FilterPresetImportActivity[] {
  try { return parseFilterPresetImportActivities(storage()?.getItem(FILTER_PRESET_IMPORT_ACTIVITY_KEY) ?? null); } catch { return []; }
}

export function saveFilterPresetImportActivities(entries: FilterPresetImportActivity[]): void {
  try { storage()?.setItem(FILTER_PRESET_IMPORT_ACTIVITY_KEY, JSON.stringify(parseFilterPresetImportActivities(JSON.stringify(entries)))); } catch { /* local convenience only */ }
}

function isCommandPaletteRecentAction(value: unknown): value is CommandPaletteRecentAction {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.actionId === "string" && entry.actionId.length > 0 && entry.actionId.length <= 80 && typeof entry.usedAt === "number" && Number.isFinite(entry.usedAt);
}

export function parseCommandPaletteRecents(value: string | null): CommandPaletteRecentAction[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter(isCommandPaletteRecentAction).sort((a, b) => b.usedAt - a.usedAt)
      .filter((entry) => !seen.has(entry.actionId) && Boolean(seen.add(entry.actionId)))
      .slice(0, MAX_COMMAND_PALETTE_RECENTS);
  } catch {
    return [];
  }
}

export function loadCommandPaletteRecents(): CommandPaletteRecentAction[] {
  try { return parseCommandPaletteRecents(storage()?.getItem(COMMAND_PALETTE_RECENTS_KEY) ?? null); } catch { return []; }
}

export function saveCommandPaletteRecents(entries: CommandPaletteRecentAction[]): void {
  try { storage()?.setItem(COMMAND_PALETTE_RECENTS_KEY, JSON.stringify(parseCommandPaletteRecents(JSON.stringify(entries)))); } catch { /* local convenience only */ }
}

export function recordCommandPaletteRecent(entries: CommandPaletteRecentAction[], actionId: string, usedAt = Date.now()): CommandPaletteRecentAction[] {
  if (!actionId.trim() || actionId.length > 80) return parseCommandPaletteRecents(JSON.stringify(entries));
  return parseCommandPaletteRecents(JSON.stringify([{ actionId, usedAt }, ...entries.filter((entry) => entry.actionId !== actionId)]));
}

export function listFilterPresetFolders(entries: ResultFilterPreset[]): string[] {
  const folders = new Set(entries.map((preset) => normalizePresetFolder(preset.folder)));
  folders.add(DEFAULT_FILTER_PRESET_FOLDER);
  return Array.from(folders).sort((a, b) => {
    if (a === DEFAULT_FILTER_PRESET_FOLDER) return -1;
    if (b === DEFAULT_FILTER_PRESET_FOLDER) return 1;
    return a.localeCompare(b);
  });
}
