import { describe, expect, it } from "vitest";
import { activeColumnFilterCount, filterResultRows } from "./tableFilter";

describe("result-table filtering", () => {
  it("matches rendered cell text without changing the source rows", () => {
    const rows = [[1, "India", null], [2, "Germany", 42.5], [3, "INDIA", 18]];
    expect(filterResultRows(rows, "india")).toEqual([[1, "India", null], [3, "INDIA", 18]]);
    expect(filterResultRows(rows, "NULL")).toEqual([[1, "India", null]]);
    expect(filterResultRows(rows, "")).toBe(rows);
  });

  it("composes the global filter with specific rendered columns", () => {
    const rows = [[1, "India", "paid"], [2, "India", "pending"], [3, "Germany", "paid"]];
    expect(filterResultRows(rows, "india", { 2: "paid" })).toEqual([[1, "India", "paid"]]);
    expect(filterResultRows(rows, "", { 1: "germany" })).toEqual([[3, "Germany", "paid"]]);
    expect(activeColumnFilterCount({ 0: "", 1: "India", 2: "  paid  " })).toBe(2);
  });
});
