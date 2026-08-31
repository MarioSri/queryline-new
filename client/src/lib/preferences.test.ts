import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER_PRESET_FOLDER, DEFAULT_PAGE_SIZE, deleteHistoryEntry, deleteWorkspace, deleteWorkspaceRevisions, filterWorkspacesBySearch, findDuplicateWorkspace, getWorkspaceRevisions, listWorkspaceLabels, mergeImportedFilterPresets, mergeImportedWorkspaces, parseCommandPaletteRecents, parseFilterPresetArchive, parseFilterPresetImportActivities, parseFilterPresets, parseHistory, parsePageSize, parseWorkspaceArchive, parseWorkspaceRevisions, parseWorkspaces, previewFilterPresetImport, recordCommandPaletteRecent, recordWorkspaceRevision, serializeFilterPresetArchive, serializeWorkspaceArchive, toggleHistoryPin, undoImportedFilterPresets, upsertFilterPreset, upsertWorkspace } from "./preferences";

describe("Queryline preferences", () => {
  it("accepts only supported page sizes", () => {
    expect(parsePageSize("500")).toBe(500);
    expect(parsePageSize("51")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(null)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("retains only valid persisted history entries", () => {
    const valid = { id: 1, label: "Run", sql: "SELECT 1", elapsedMs: 2, rowCount: 1, ts: "09:30" };
    expect(parseHistory(JSON.stringify([valid, { ...valid, id: "bad" }, { label: "missing fields" }]))).toEqual([{ ...valid, pinned: false }]);
    expect(parseHistory("not json")).toEqual([]);
  });

  it("pins entries first and deletes only the chosen saved query", () => {
    const entries = parseHistory(JSON.stringify([
      { id: 1, label: "Run", sql: "SELECT 1", elapsedMs: 2, rowCount: 1, ts: "09:30" },
      { id: 2, label: "Run", sql: "SELECT 2", elapsedMs: 3, rowCount: 1, ts: "09:31" },
    ]));
    const pinned = toggleHistoryPin(entries, 2);
    expect(pinned.map((entry) => entry.id)).toEqual([2, 1]);
    expect(deleteHistoryEntry(pinned, 2).map((entry) => entry.id)).toEqual([1]);
  });

  it("validates, updates, and removes browser-local named workspaces", () => {
    const saved = parseWorkspaces(JSON.stringify([
      { id: "revenue", name: "Monthly revenue", sql: "SELECT 1", createdAt: 10, updatedAt: 20 },
      { id: "bad", name: "", sql: "SELECT 2", createdAt: 10, updatedAt: 30 },
    ]));
    expect(saved).toEqual([{ id: "revenue", name: "Monthly revenue", label: "", sql: "SELECT 1", createdAt: 10, updatedAt: 20 }]);
    const updated = upsertWorkspace(saved, { id: "revenue", name: "Revenue 2026", label: "Interview prep", sql: "SELECT 2", createdAt: 10, updatedAt: 40 });
    expect(updated).toEqual([{ id: "revenue", name: "Revenue 2026", label: "Interview prep", sql: "SELECT 2", createdAt: 10, updatedAt: 40 }]);
    expect(deleteWorkspace(updated, "revenue")).toEqual([]);
  });

  it("rejects duplicate workspace names case-insensitively while allowing an active workspace rename", () => {
    const saved = parseWorkspaces(JSON.stringify([
      { id: "revenue", name: "Monthly Revenue", sql: "SELECT 1", createdAt: 10, updatedAt: 20 },
      { id: "orders", name: "Orders", sql: "SELECT 2", createdAt: 10, updatedAt: 15 },
    ]));
    expect(findDuplicateWorkspace(saved, " monthly   revenue ")?.id).toBe("revenue");
    expect(findDuplicateWorkspace(saved, "Monthly Revenue", "revenue")).toBeUndefined();
    expect(upsertWorkspace(saved, { id: "copy", name: "MONTHLY revenue", sql: "SELECT 3", createdAt: 30, updatedAt: 30 })).toEqual(saved);
  });

  it("exports validated workspaces and merges imports without overwriting same-named local drafts", () => {
    const existing = parseWorkspaces(JSON.stringify([{ id: "revenue", name: "Revenue", sql: "SELECT 1", createdAt: 1, updatedAt: 3 }]));
    const archive = serializeWorkspaceArchive([
      { id: "revenue", name: "New query", sql: "SELECT 2", createdAt: 2, updatedAt: 4 },
      { id: "duplicate", name: " revenue ", sql: "SELECT 3", createdAt: 2, updatedAt: 5 },
    ], "2026-08-20T00:00:00.000Z");
    const imported = parseWorkspaceArchive(archive);
    expect(imported?.length).toBe(2);
    const merged = mergeImportedWorkspaces(existing, imported ?? []);
    expect(merged.imported).toBe(1);
    expect(merged.skipped).toBe(1);
    expect(merged.workspaces.map((workspace) => workspace.name)).toEqual(["New query", "Revenue"]);
    expect(merged.workspaces[0].id).toBe("revenue-imported");
    expect(parseWorkspaceArchive('{"format":"wrong"}')).toBeNull();
  });

  it("validates and updates named presets containing global and column filters", () => {
    const parsed = parseFilterPresets(JSON.stringify([{ id: "march", name: "March orders", filter: "paid", columnFilters: { 2: "2024-03" }, createdAt: 1, updatedAt: 2 }, { id: "bad", name: "", filter: "x", columnFilters: {}, createdAt: 1, updatedAt: 2 }]));
    expect(parsed).toHaveLength(1);
    const updated = upsertFilterPreset(parsed, { id: "march", name: "March orders", filter: "paid", columnFilters: { 2: "2024-04" }, createdAt: 1, updatedAt: 3 });
    expect(updated).toEqual([{ id: "march", name: "March orders", folder: "General", filter: "paid", columnFilters: { 2: "2024-04" }, createdAt: 1, updatedAt: 3 }]);
  });

  it("organizes filter presets into folders while allowing matching names in different folders", () => {
    const saved = parseFilterPresets(JSON.stringify([{ id: "march", name: "Orders", folder: "Finance", filter: "paid", columnFilters: {}, createdAt: 1, updatedAt: 2 }]));
    expect(saved[0].folder).toBe("Finance");
    const separateFolder = upsertFilterPreset(saved, { id: "ops", name: "Orders", folder: "Operations", filter: "open", columnFilters: {}, createdAt: 2, updatedAt: 3 });
    expect(separateFolder).toHaveLength(2);
    expect(parseFilterPresets(JSON.stringify([{ id: "legacy", name: "Legacy", filter: "x", columnFilters: {}, createdAt: 1, updatedAt: 2 }]))[0].folder).toBe(DEFAULT_FILTER_PRESET_FOLDER);
  });

  it("records bounded workspace revisions and removes them with their workspace", () => {
    const workspace = { id: "revenue", name: "Revenue", label: "Finance", sql: "SELECT 1", createdAt: 1, updatedAt: 1 };
    const first = recordWorkspaceRevision({}, workspace, 10);
    const second = recordWorkspaceRevision(first, { ...workspace, sql: "SELECT 2", updatedAt: 20 }, 20);
    expect(getWorkspaceRevisions(second, "revenue").map((revision) => revision.sql)).toEqual(["SELECT 2", "SELECT 1"]);
    expect(parseWorkspaceRevisions(JSON.stringify(second)).revenue).toHaveLength(2);
    expect(deleteWorkspaceRevisions(second, "revenue")).toEqual({});
  });

  it("normalizes optional workspace labels for portable filing groups", () => {
    const workspaces = parseWorkspaces(JSON.stringify([
      { id: "revenue", name: "Revenue", label: " Finance  ", sql: "SELECT 1", createdAt: 1, updatedAt: 1 },
      { id: "orders", name: "Orders", label: "Operations", sql: "SELECT 2", createdAt: 1, updatedAt: 2 },
    ]));
    expect(workspaces.find((workspace) => workspace.id === "revenue")?.label).toBe("Finance");
    expect(listWorkspaceLabels(workspaces)).toEqual(["Finance", "Operations"]);
    const revenue = workspaces.find((workspace) => workspace.id === "revenue");
    expect(revenue).toBeDefined();
    expect(recordWorkspaceRevision({}, revenue!, 3).revenue[0].label).toBe("Finance");
    expect(filterWorkspacesBySearch(workspaces, "operations").map((workspace) => workspace.id)).toEqual(["orders"]);
    expect(filterWorkspacesBySearch(workspaces, "rev").map((workspace) => workspace.id)).toEqual(["revenue"]);
  });

  it("exports validated filter presets and merges imports without overwriting matching folder and name pairs", () => {
    const existing = parseFilterPresets(JSON.stringify([{ id: "finance", name: "Paid", folder: "Finance", filter: "paid", columnFilters: {}, createdAt: 1, updatedAt: 3 }]));
    const archive = serializeFilterPresetArchive([
      { id: "finance", name: "Open", folder: "Finance", filter: "open", columnFilters: { 1: "2026" }, createdAt: 2, updatedAt: 4 },
      { id: "duplicate", name: " paid ", folder: "finance", filter: "late", columnFilters: {}, createdAt: 2, updatedAt: 5 },
    ], "2026-08-20T00:00:00.000Z");
    const imported = parseFilterPresetArchive(archive);
    const merged = mergeImportedFilterPresets(existing, imported ?? []);
    expect(merged.imported).toBe(1);
    expect(merged.skipped).toBe(1);
    expect(merged.presets.map((preset) => preset.name)).toEqual(["Open", "Paid"]);
    expect(merged.presets[0].id).toBe("finance-imported");
    expect(parseFilterPresetArchive('{"format":"wrong"}')).toBeNull();
  });

  it("previews filter preset imports before a merge while preserving collision safeguards", () => {
    const existing = parseFilterPresets(JSON.stringify([{ id: "paid", name: "Paid", folder: "Finance", filter: "paid", columnFilters: {}, createdAt: 1, updatedAt: 2 }]));
    const incoming = parseFilterPresets(JSON.stringify([
      { id: "paid", name: "Open", folder: "Finance", filter: "open", columnFilters: {}, createdAt: 2, updatedAt: 3 },
      { id: "duplicate", name: "paid", folder: "finance", filter: "late", columnFilters: {}, createdAt: 2, updatedAt: 4 },
    ]));
    const preview = previewFilterPresetImport(existing, incoming);
    expect(preview.imported).toBe(1);
    expect(preview.skipped).toBe(1);
    expect(preview.importablePresets.map((preset) => preset.id)).toEqual(["paid-imported"]);
    expect(preview.skippedPresets.map((preset) => preset.name)).toEqual(["paid"]);
  });

  it("undoes only unchanged presets created by one confirmed import", () => {
    const existing = parseFilterPresets(JSON.stringify([{ id: "paid", name: "Paid", folder: "Finance", filter: "paid", columnFilters: {}, createdAt: 1, updatedAt: 2 }]));
    const incoming = parseFilterPresets(JSON.stringify([{ id: "open", name: "Open", folder: "Finance", filter: "open", columnFilters: {}, createdAt: 3, updatedAt: 4 }]));
    const preview = previewFilterPresetImport(existing, incoming);
    const undone = undoImportedFilterPresets(preview.presets, preview.importablePresets);
    expect(undone.removed).toBe(1);
    expect(undone.protected).toBe(0);
    expect(undone.presets.map((preset) => preset.id)).toEqual(["paid"]);
    const changed = preview.presets.map((preset) => preset.id === "open" ? { ...preset, filter: "updated", updatedAt: 5 } : preset);
    const protectedUndo = undoImportedFilterPresets(changed, preview.importablePresets);
    expect(protectedUndo.removed).toBe(0);
    expect(protectedUndo.protected).toBe(1);
  });

  it("rehydrates validated import activity snapshots for safe undo after a reload", () => {
    const activities = parseFilterPresetImportActivities(JSON.stringify([{ id: "import-1", fileName: " presets.json ", importedPresets: [{ id: "paid", name: "Paid", folder: "Finance", filter: "paid", columnFilters: {}, createdAt: 1, updatedAt: 2 }], imported: 1, skipped: 0, createdAt: 10, undone: false }]));
    expect(activities).toHaveLength(1);
    expect(activities[0].fileName).toBe("presets.json");
    expect(activities[0].importedPresets[0].name).toBe("Paid");
  });

  it("keeps compact, deduplicated command recents in most-recent-first order", () => {
    const first = recordCommandPaletteRecent([], "run", 1);
    const next = recordCommandPaletteRecent(first, "save", 2);
    const repeated = recordCommandPaletteRecent(next, "run", 3);
    expect(repeated.map((entry) => entry.actionId)).toEqual(["run", "save"]);
    expect(parseCommandPaletteRecents(JSON.stringify([...repeated, { actionId: "run", usedAt: 1 }, { actionId: "", usedAt: 4 }]))).toEqual(repeated);
  });
});
