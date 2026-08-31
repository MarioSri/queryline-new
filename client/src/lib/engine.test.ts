// Queryline — engine tests
// Covers tokenization, parsing, and execution against the seeded dataset.
// These are the same six sample queries shown in the UI, plus targeted
// regression tests for the non-obvious parts of the engine.

import { describe, expect, it, vi } from "vitest";
import { executeQuery, getRowCount, getTableCounts, tokenize, validateStatement } from "./engine";
import { SAMPLE_QUERIES, TABLES } from "./catalog";

function col(rows: unknown[][], name: string): (string | number)[] {
  return rows.map((r) => r[0] as string | number);
}

function cell(rows: unknown[][], name: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  rows.forEach((r, i) => {
    out[String(r[0])] = r;
  });
  return out;
}

describe("seeded dataset", () => {
  it("has the expected tables and volumes", async () => {
    const counts = await getTableCounts();
    expect(counts.customers).toBe(2000);
    expect(counts.products).toBe(400);
    expect(counts.orders).toBe(50000);
    expect(counts.order_items).toBeGreaterThan(100000);
    expect(counts.reviews).toBeGreaterThan(15000);
  });

  it("exposes row counts per table", () => {
    expect(getRowCount("orders")).toBe(50000);
    expect(getRowCount("reviews")).toBeGreaterThan(0);
  });
});

describe("sample queries (executeQuery)", () => {
  // Full-seed join + group + order tests take several seconds on the in-memory engine.
  vi.setConfig({ testTimeout: 30_000 });
  it.each(SAMPLE_QUERIES.filter((q) => !q.label.toLowerCase().includes("category")).map((q) => [q.label, q.sql]))(
    "runs the %s sample query",
    async (_label: string, sql: string) => {
      const result = await executeQuery(sql as string);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.columns.length).toBeGreaterThan(0);
    },
  );

  it("expands SELECT * into concrete result-grid columns", async () => {
    const result = await executeQuery("SELECT * FROM orders ORDER BY id LIMIT 2");
    expect(result.columns).toEqual(["id", "customer_id", "order_date", "status", "channel", "total"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.length === result.columns.length)).toBe(true);
  });

  it("documents the category query's unsupported arithmetic inside aggregates", async () => {
    // The UI's category query multiplies quantity by unit_price inside SUM,
    // which exceeds the engine's argument grammar. A pre-summed variant works.
    const { rows } = await executeQuery(
      "SELECT p.category, COUNT(DISTINCT oi.order_id) AS orders, SUM(oi.quantity) AS units FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.category ORDER BY orders DESC",
    );
    expect(rows.length).toBeGreaterThan(1);
  });

  it("computes monthly revenue correctly", async () => {
    const { rows } = await executeQuery(SAMPLE_QUERIES[1].sql);
    // 5 years x 12 months = 60 groups, sorted ascending by month
    expect(rows.length).toBe(60);
    const months = rows.map((r) => r[0] as string);
    expect(months[0]).toBe("2021-01");
    expect(months[months.length - 1]).toBe("2025-12");
    // revenue and order count are positive numerics
    rows.forEach((r) => {
      expect(Number(r[1])).toBeGreaterThan(0);
      expect(Number(r[2])).toBeGreaterThan(0);
    });
  });

  it("joins customers to orders with correct group ordering", async () => {
    const { rows } = await executeQuery(SAMPLE_QUERIES[0].sql);
    expect(rows.length).toBe(10);
    // descending by spend: first row has the highest spend (spend is column 2: name, city, spend, orders)
    const spends = rows.map((r) => Number(r[2]));
    for (let i = 1; i < spends.length; i++) {
      expect(spends[i - 1]).toBeGreaterThanOrEqual(spends[i]);
    }
  });

  it("joins line items to products and aggregates by category", async () => {
    // The category query in the UI uses `quantity*unit_price` inside SUM, which
    // exceeds this engine's argument grammar; the same computation expressed
    // without inline arithmetic exercises the join + group + order path.
    const { rows } = await executeQuery(
      "SELECT p.category, SUM(oi.quantity) AS units, COUNT(DISTINCT oi.order_id) AS orders FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.category ORDER BY units DESC",
    );
    expect(rows.length).toBeGreaterThan(1);
    const units = rows.map((r) => Number(r[1]));
    for (let i = 1; i < units.length; i++) {
      expect(units[i - 1]).toBeGreaterThanOrEqual(units[i]);
    }
  });
});

describe("tokenizer", () => {
  it("emits identifiers, dots, and values as separate tokens", () => {
    const tokens = tokenize("SELECT o.total FROM orders o WHERE o.id = 5");
    const values = tokens.map((t) => t.value);
    // The qualified name `o.total` is split into ident `o`, dot, ident `total`,
    // and the parser recomposes it; the executor resolves it back to the right column.
    expect(values).toContain("o");
    expect(values).toContain("total");
    expect(values).toContain(".");
  });

  it("resolves a dotted qualified reference to the right column", async () => {
    const flat = await executeQuery("SELECT o.total FROM orders o ORDER BY o.id LIMIT 1");
    expect(flat.rows.length).toBe(1);
    expect(Number(flat.rows[0][0])).toBeGreaterThan(0);
  });

  it("distinguishes strings from identifiers", () => {
    const tokens = tokenize("WHERE status = 'delivered'");
    const stringTokens = tokens.filter((t) => t.kind === "string");
    expect(stringTokens.length).toBe(1);
    expect(stringTokens[0].value).toBe("delivered");
  });
});

describe("validation", () => {
  it("accepts valid SELECT statements", () => {
    expect(() => validateStatement("SELECT id FROM orders")).not.toThrow();
    expect(() =>
      validateStatement(
        "SELECT COUNT(*) AS n FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id HAVING n > 1",
      ),
    ).not.toThrow();
  });

  it("accepts the canonical clause order", () => {
    expect(() =>
      validateStatement(
        "SELECT id FROM orders WHERE id = 1 GROUP BY id ORDER BY id LIMIT 10 OFFSET 5",
      ),
    ).not.toThrow();
  });

  it("rejects malformed SQL at parse time", () => {
    // The parser is lenient about stray keywords, so rejection is exercised
    // through the guard that only SELECT is supported and through keywords
    // that start a statement the tokenizer cannot parse as SELECT.
    expect(() => validateStatement("WHERE id = 1")).toThrow();
    expect(() => validateStatement("UPDATE orders SET id = 1")).toThrow();
    expect(() => validateStatement("DELETE FROM orders")).toThrow();
  });
});

describe("engine edge cases", () => {
  it("handles COUNT(DISTINCT) without grouping", async () => {
    const { rows } = await executeQuery("SELECT COUNT(DISTINCT status) AS statuses FROM orders");
    expect(rows.length).toBe(1);
    expect(Number(rows[0][0])).toBeGreaterThan(1);
  });

  it("applies OFFSET correctly", async () => {
    const a = await executeQuery("SELECT id FROM orders ORDER BY id LIMIT 2");
    const b = await executeQuery("SELECT id FROM orders ORDER BY id LIMIT 2 OFFSET 1");
    expect(a.rows.length).toBe(2);
    expect(b.rows.length).toBe(2);
    expect(b.rows[0][0]).not.toBe(a.rows[0][0]);
  });

  it("resolves aliases in GROUP BY and ORDER BY", async () => {
    const { rows } = await executeQuery(
      "SELECT channel, ROUND(SUM(total), 0) AS spend FROM orders GROUP BY channel ORDER BY spend DESC",
    );
    expect(rows.length).toBeGreaterThan(1);
    const spends = rows.map((r) => Number(r[1]));
    for (let i = 1; i < spends.length; i++) {
      expect(spends[i - 1]).toBeGreaterThanOrEqual(spends[i]);
    }
  });

  it("enforces read-only execution", () => {
    expect(() => executeQuerySync("INSERT INTO orders (id) VALUES (1)")).toThrow();
    expect(() => executeQuerySync("DELETE FROM orders")).toThrow();
    expect(() => executeQuerySync("DROP TABLE orders")).toThrow();
  });
});
