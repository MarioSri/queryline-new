/**
 * Ledger Light — result-table text filtering.
 * Filtering deliberately follows the table's rendered cell text so the term a
 * person sees and types maps directly to the rows they receive.
 */

export function formatResultValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return String(value);
}

export type ColumnFilters = Record<number, string>;

function normalizeTerm(term: string): string {
  return term.trim().toLocaleLowerCase();
}

export function activeColumnFilterCount(filters: ColumnFilters): number {
  return Object.values(filters).filter((term) => normalizeTerm(term).length > 0).length;
}

export function filterResultRows(rows: unknown[][], term: string, columnFilters: ColumnFilters = {}): unknown[][] {
  const normalized = term.trim().toLocaleLowerCase();
  const activeFilters = Object.entries(columnFilters)
    .map(([index, value]) => [Number(index), normalizeTerm(value)] as const)
    .filter(([, value]) => value.length > 0);
  if (!normalized && activeFilters.length === 0) return rows;
  return rows.filter((row) => {
    const globalMatch = !normalized || row.some((cell) => formatResultValue(cell).toLocaleLowerCase().includes(normalized));
    const columnMatch = activeFilters.every(([index, value]) => formatResultValue(row[index]).toLocaleLowerCase().includes(value));
    return globalMatch && columnMatch;
  });
}
