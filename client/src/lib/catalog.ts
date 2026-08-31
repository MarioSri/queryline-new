/**
 * Ledger Light — metadata used to render the initial SQL console.
 *
 * This deliberately lives outside the deterministic seed generator so the
 * schema rail and starter queries render immediately while the larger SQL
 * execution engine and its in-memory dataset load only when a query runs.
 */

export interface TableMeta {
  name: string;
  columns: string[];
  rowCount: number;
  description: string;
}

export const TABLES: TableMeta[] = [
  { name: "customers", columns: ["id", "name", "city", "country", "joined_at", "segment"], rowCount: 2_000, description: "Registered customers with segment tags (B2C / B2B / VIP)." },
  { name: "products", columns: ["id", "sku", "name", "category", "price", "created_at"], rowCount: 400, description: "Catalog items across six categories." },
  { name: "orders", columns: ["id", "customer_id", "order_date", "status", "channel", "total"], rowCount: 50_000, description: "Five years of orders. The table that proves pagination." },
  { name: "order_items", columns: ["id", "order_id", "product_id", "quantity", "unit_price"], rowCount: 120_000, description: "Line items per order, two to four items on average." },
  { name: "reviews", columns: ["id", "order_id", "product_id", "rating", "comment"], rowCount: 18_000, description: "Post-purchase ratings and one-line comments." },
];

export const SAMPLE_QUERIES: { label: string; sql: string }[] = [
  { label: "Top 10 customers by spend", sql: "SELECT c.name, c.city, ROUND(SUM(o.total),2) AS spend, COUNT(o.id) AS orders\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nGROUP BY c.id\nORDER BY spend DESC\nLIMIT 10;" },
  { label: "Monthly revenue trend", sql: "SELECT substr(order_date,1,7) AS month, ROUND(SUM(total),2) AS revenue, COUNT(*) AS orders\nFROM orders\nGROUP BY month\nORDER BY month;" },
  { label: "Category performance", sql: "SELECT p.category, COUNT(DISTINCT oi.order_id) AS orders_with_category, SUM(oi.quantity) AS units_sold, ROUND(SUM(oi.quantity*oi.unit_price),2) AS revenue\nFROM order_items oi\nJOIN products p ON p.id = oi.product_id\nGROUP BY p.category\nORDER BY revenue DESC;" },
  { label: "All orders (pagination demo)", sql: "SELECT * FROM orders ORDER BY order_date DESC;" },
  { label: "VIP customers in India", sql: "SELECT * FROM customers WHERE segment = 'VIP' AND country = 'India' ORDER BY joined_at;" },
  { label: "Average rating by category", sql: "SELECT p.category, ROUND(AVG(r.rating),2) AS avg_rating, COUNT(*) AS reviews\nFROM reviews r\nJOIN products p ON p.id = r.product_id\nGROUP BY p.category\nORDER BY avg_rating DESC;" },
];

export const SUPPORTED_SQL: { title: string; detail: string }[] = [
  { title: "Read-only SELECT", detail: "SELECT, DISTINCT, aliases, and * expansion. Data-changing statements are blocked." },
  { title: "Tables and joins", detail: "FROM with table aliases; JOIN or LEFT JOIN with ON conditions." },
  { title: "Filtering", detail: "WHERE with AND, OR, NOT, comparisons, LIKE, IN, and IS [NOT] NULL." },
  { title: "Summaries", detail: "GROUP BY, HAVING, COUNT, SUM, AVG, MIN, MAX, and COUNT(DISTINCT ...)." },
  { title: "Shaping results", detail: "ORDER BY aliases or positions, ASC/DESC, LIMIT, and OFFSET." },
  { title: "Scalar functions", detail: "ROUND, substr, LOWER, UPPER, LENGTH, COALESCE, and ABS." },
];
