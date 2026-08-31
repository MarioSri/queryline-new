/**
 * Ledger Light — SQL Query Runner
 *
 * A small, hand-rolled SQL engine: tokenizer → parser → executor, running
 * directly over in-memory row arrays. No WebAssembly, no third-party
 * library, no heap surprises. The expensive part of a query console is
 * never the SQL — it is materializing thousands of rows into the DOM —
 * and this engine keeps that pipeline fully under our control.
 *
 * Supported surface (enough for every sample query and free exploration):
 * - SELECT [DISTINCT] col-exprs FROM t [alias]
 * - [LEFT] JOIN t [alias] ON cond
 * - WHERE cond  (AND/OR, NOT, =, !=, <, >, <=, >=, LIKE, IN, IS [NOT] NULL)
 * - GROUP BY col [HAVING cond]
 * - ORDER BY col [ASC|DESC] — accepts column names, aliases, or positions
 * - LIMIT n [OFFSET m]
 * - Aggregates: COUNT(*) , COUNT(col), COUNT(DISTINCT col), SUM, AVG,
 *   MIN, MAX — plus ROUND(x, d), substr(s, a, b), LOWER/UPPER, LENGTH,
 *   COALESCE, ABS as scalar functions
 * - * expands to all columns of the joined tables
 * - Read-only by construction: the parser only understands SELECT.
 */

import { buildSeedStatements } from "./seed";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  elapsedMs: number;
}

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

// ---------------------------------------------------------------------------
// Data layer: rows are plain objects per table; the seed SQL is parsed once
// into memory so the engine stays a pure-TS artifact.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Scoped = { table: string; alias?: string; row: Row };

const TABLE_DATA: Record<string, Row[]> = {};

function seedDatabase(): void {
  if (Object.keys(TABLE_DATA).length > 0) return;
  // Parse the CREATE TABLE statements to learn column names, then the
  // INSERT statements for values. The seed module stays the single source
  // of truth for the schema, so schema and data can never drift apart.
  const creates: Record<string, string[]> = {};
  const inserts: Record<string, unknown[][]> = {};
  for (const stmt of buildSeedStatements()) {
    const c = stmt.match(/^CREATE TABLE (\w+) \((.+)\);$/);
    if (c) {
      creates[c[1]] = c[2].split(",").map((col) => col.trim().split(/\s+/)[0]);
      inserts[c[1]] = [];
      continue;
    }
    // INSERT INTO t [(cols)] VALUES (..),(..),...;  — many tuples per statement
    const m = stmt.match(/^INSERT INTO (\w+)(?: \([^)]*\))? VALUES (.+);$/);
    if (m) {
      const table = m[1];
      if (!inserts[table]) inserts[table] = [];
      for (const body of splitTuples(m[2])) inserts[table].push(parseTuple(body));
      continue;
    }
  }
  for (const [table, rows] of Object.entries(inserts)) {
    const cols = creates[table];
    TABLE_DATA[table] = rows.map((r) =>
      Object.fromEntries(cols.map((col, i) => [col, coerce(r[i])]))
    );
  }
}

function coerce(v: unknown): unknown {
  if (v === null) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s; // dates stay strings
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

/** Split a multi-tuple VALUES body "(a,b),(c,d)" into individual tuple bodies. */
function splitTuples(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'" && !inStr) {
      inStr = true;
      cur += ch;
    } else if (ch === "'" && inStr) {
      if (body[i + 1] === "'") { cur += "''"; i++; }
      else {
        inStr = false;
        cur += ch;
      }
    } else if (!inStr && ch === "(") {
      depth++;
      if (depth === 1) cur = "";
      else cur += ch;
    } else if (!inStr && ch === ")") {
      depth--;
      if (depth === 0) out.push(cur);
      else cur += ch;
    } else {
      // any other char — including content inside quoted strings — belongs to the tuple
      cur += ch;
    }
  }
  return out;
}

/** Parse an INSERT tuple body, respecting single-quoted strings. */
function parseTuple(body: string): unknown[] {
  const out: unknown[] = [];
  let cur = "";
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'" && !inStr) {
      inStr = true;
    } else if (ch === "'" && inStr) {
      if (body[i + 1] === "'") {
        cur += "'";
        i++;
      } else inStr = false;
    } else if (!inStr && ch === "(") {
      depth++;
      cur += ch;
    } else if (!inStr && ch === ")") {
      depth--;
      cur += ch;
    } else if (!inStr && depth === 0 && ch === ",") {
      out.push(normalizeLiteral(cur));
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(normalizeLiteral(cur));
  return out;
}

function normalizeLiteral(s: string): unknown {
  const t = s.trim();
  if (t === "NULL") return null;
  if (/^'(.*)'$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function getTableData(name: string): Row[] {
  seedDatabase();
  if (!TABLE_DATA[name]) throw new QueryError(`Unknown table: ${name}`);
  return TABLE_DATA[name];
}

export function getRowCount(name: string): number {
  return getTableData(name).length;
}

// ---------------------------------------------------------------------------
// Engine public API
// ---------------------------------------------------------------------------

export function validateStatement(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) throw new QueryError("Empty query. Write a SELECT and press Run.");
  const statements = trimmed.split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length === 0) throw new QueryError("Empty query. Write a SELECT and press Run.");
  for (const st of statements) {
    if (!/^SELECT\b/i.test(st)) {
      throw new QueryError(
        "Only SELECT statements are allowed in this console. INSERT / UPDATE / DELETE / DROP are blocked."
      );
    }
  }
}

export function executeQuerySync(sql: string): QueryResult {
  validateStatement(sql);
  const trimmed = sql.trim().replace(/;+\s*$/, "").trim();
  const start = performance.now();
  const q = parse(trimmed);
  const result = execute(q);
  return { ...result, elapsedMs: Math.max(1, Math.round(performance.now() - start)) };
}

export async function executeQuery(sql: string): Promise<QueryResult> {
  seedDatabase();
  return executeQuerySync(sql);
}

export async function getTableCounts(): Promise<Record<string, number>> {
  seedDatabase();
  const out: Record<string, number> = {};
  for (const name of Object.keys(TABLE_DATA)) out[name] = TABLE_DATA[name].length;
  return out;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Expr =
  | { kind: "ident"; table?: string; name: string }
  | { kind: "literal"; value: unknown }
  | { kind: "star"; table?: string }
  | { kind: "call"; name: string; args: Expr[]; distinct?: boolean }
  | { kind: "bin"; op: string; left: Expr; right: Expr }
  | { kind: "alias"; inner: Expr; alias: string };

type Cond =
  | { kind: "cmp"; left: Expr; op: string; right: Expr }
  | { kind: "and"; conds: Cond[] }
  | { kind: "or"; conds: Cond[] }
  | { kind: "in"; expr: Expr; values: unknown[]; negate: boolean }
  | { kind: "like"; expr: Expr; pattern: Expr; negate: boolean }
  | { kind: "null"; expr: Expr; negate: boolean }
  | { kind: "not"; inner: Cond };

interface ParsedQuery {
  distinct: boolean;
  select: Expr[];
  from: { table: string; alias?: string };
  joins: { type: "JOIN" | "LEFT JOIN"; table: string; alias?: string; on: Cond }[];
  where?: Cond;
  groupBy: Expr[];
  having?: Cond;
  orderBy: { expr: Expr; desc: boolean }[];
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token = { kind: string; value: string };

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let str = "";
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            str += "'";
            j += 2;
          } else break;
        } else str += sql[j++];
      }
      tokens.push({ kind: "string", value: str });
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < sql.length && /[\d.]/.test(sql[j])) j++;
      tokens.push({ kind: "number", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[\w]/.test(sql[j])) j++;
      tokens.push({ kind: "ident", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (["!=", "<>", "<=", ">="].includes(two)) {
      tokens.push({ kind: "op", value: two === "<>" ? "!=" : two });
      i += 2;
      continue;
    }
    if ("()*,=<>+-.".includes(ch)) {
      tokens.push({ kind: ch === "." ? "dot" : ch === "(" || ch === ")" || ch === "*" || ch === "," ? "punct" : "op", value: ch });
      i++;
      continue;
    }
    if (ch === "|" && sql[i + 1] === "|") {
      tokens.push({ kind: "op", value: "||" });
      i += 2;
      continue;
    }
    if (ch === ";") {
      tokens.push({ kind: "punct", value: ";" });
      i++;
      continue;
    }
    throw new QueryError(`Unexpected character '${ch}' at position ${i}.`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "IS",
  "NULL", "AS", "ON", "JOIN", "LEFT", "INNER", "GROUP", "BY", "HAVING",
  "ORDER", "ASC", "DESC", "LIMIT", "OFFSET", "DISTINCT", "TRUE", "FALSE",
  "SET", "INTO", "VALUES", "UPDATE", "DELETE", "DROP", "INSERT", "ALTER",
  "CREATE", "COUNT", "SUM", "AVG", "MIN", "MAX", "ROUND", "SUBSTR",
  "SUBSTRING", "LOWER", "UPPER", "LENGTH", "COALESCE", "ABS", "CAST",
]);

class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(sql: string): ParsedQuery {
    this.tokens = tokenize(sql);
    this.pos = 0;
    return this.parseSelect();
  }

  private peek(off = 0): Token | undefined {
    return this.tokens[this.pos + off];
  }

  private eat(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new QueryError("Unexpected end of query.");
    this.pos++;
    return t;
  }

  private expect(value: string): Token {
    const t = this.eat();
    if (t.value.toUpperCase() !== value.toUpperCase()) {
      throw new QueryError(`Expected '${value}' but found '${t.value}'.`);
    }
    return t;
  }

  private match(value: string): boolean {
    const t = this.peek();
    if (!t || t.value.toUpperCase() !== value.toUpperCase()) return false;
    this.pos++;
    return true;
  }

  private atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private isKeyword(t?: Token): boolean {
    return !!t && t.kind === "ident" && KEYWORDS.has(t.value.toUpperCase());
  }

  private parseSelect(): ParsedQuery {
    this.expect("SELECT");
    const distinct = this.match("DISTINCT");
    const select: Expr[] = [];
    do {
      const inner = this.parseExpr();
      // column alias: [AS] name
      if (this.match("AS")) {
        const alias = this.eatIdent();
        select.push({ kind: "alias", inner, alias });
      } else {
        const next = this.peek();
        if (next?.kind === "ident" && !this.isKeyword(next)) {
          select.push({ kind: "alias", inner, alias: this.eatIdent() });
        } else {
          select.push(inner);
        }
      }
    } while (this.match(","));

    this.expect("FROM");
    const from = this.parseTableRef();
    const joins: ParsedQuery["joins"] = [];
    while (true) {
      let type: "JOIN" | "LEFT JOIN" = "JOIN";
      if (this.match("LEFT")) {
        this.expect("JOIN");
        type = "LEFT JOIN";
      } else if (this.match("JOIN")) {
        type = "JOIN";
      } else break;
      const table = this.parseTableRef();
      this.expect("ON");
      const on = this.parseCond();
      joins.push({ type, table: table.table, alias: table.alias, on });
    }

    let where: Cond | undefined;
    if (this.match("WHERE")) where = this.parseCond();

    const groupBy: Expr[] = [];
    if (this.match("GROUP")) {
      this.expect("BY");
      do {
        groupBy.push(this.parseExpr());
      } while (this.match(","));
    }

    let having: Cond | undefined;
    if (this.match("HAVING")) having = this.parseCond();

    const orderBy: { expr: Expr; desc: boolean }[] = [];
    if (this.match("ORDER")) {
      this.expect("BY");
      do {
        const expr = this.parseExpr();
        const desc = this.match("DESC");
        if (!desc) this.match("ASC");
        orderBy.push({ expr, desc });
      } while (this.match(","));
    }

    let limit: number | undefined;
    let offset: number | undefined;
    if (this.match("LIMIT")) {
      limit = this.parseNumber();
      if (this.match("OFFSET")) offset = this.parseNumber();
    }

    // tolerate trailing semicolons
    while (!this.atEnd() && this.peek()!.value === ";") this.eat();

    if (!this.atEnd()) {
      throw new QueryError(`Unexpected token '${this.peek()?.value}' after query end.`);
    }
    return { distinct, select, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseNumber(): number {
    const t = this.eat();
    const n = Number(t.value);
    if (t.kind !== "number" || Number.isNaN(n)) {
      throw new QueryError(`Expected a number but found '${t.value}'.`);
    }
    return n;
  }

  private parseTableRef(): { table: string; alias?: string } {
    const name = this.eat();
    if (name.kind !== "ident") throw new QueryError(`Expected table name but found '${name.value}'.`);
    let alias: string | undefined;
    if (this.match("AS")) {
      alias = this.eatIdent();
    } else {
      // implicit alias: bare identifier that is not a keyword
      const next = this.peek();
      if (next?.kind === "ident" && !this.isKeyword(next)) alias = this.eatIdent();
    }
    return { table: name.value, alias };
  }

  private eatIdent(): string {
    const t = this.eat();
    if (t.kind !== "ident") throw new QueryError(`Expected identifier but found '${t.value}'.`);
    return t.value;
  }

  private parseCond(): Cond {
    const ors: Cond[] = [this.parseAndCond()];
    while (this.match("OR")) ors.push(this.parseAndCond());
    return ors.length === 1 ? ors[0] : { kind: "or", conds: ors };
  }

  private parseAndCond(): Cond {
    const ands: Cond[] = [this.parseAtomCond()];
    while (this.match("AND")) ands.push(this.parseAtomCond());
    return ands.length === 1 ? ands[0] : { kind: "and", conds: ands };
  }

  private parseAtomCond(): Cond {
    if (this.match("NOT")) return { kind: "not", inner: this.parseAtomCond() };
    const left = this.parseExpr();
    let negate = this.match("NOT");
    if (this.match("IS")) {
      if (this.match("NOT")) negate = !negate;
      this.expect("NULL");
      return { kind: "null", expr: left, negate };
    }
    if (this.match("IN")) {
      this.expect("(");
      const values: unknown[] = [];
      do {
        values.push(this.parseLiteralValue());
      } while (this.match(","));
      this.expect(")");
      return { kind: "in", expr: left, values, negate };
    }
    if (this.match("LIKE")) {
      const pattern = this.parseExpr();
      return { kind: "like", expr: left, pattern, negate };
    }
    const op = this.eat();
    if (op.kind !== "op") throw new QueryError(`Expected comparison operator but found '${op.value}'.`);
    const right = this.parseExpr();
    return { kind: "cmp", left, op: op.value, right };
  }

  private parseLiteralValue(): unknown {
    const t = this.eat();
    if (t.kind === "string") return t.value;
    if (t.kind === "number") return Number(t.value);
    if (t.kind === "ident" && t.value.toUpperCase() === "NULL") return null;
    throw new QueryError(`Expected a literal value but found '${t.value}'.`);
  }

  private parseExpr(): Expr {
    if (this.peek()?.value === "(") {
      this.eat();
      const inner = this.parseExpr();
      this.expect(")");
      return inner;
    }
    const t = this.eat();
    let expr: Expr;
    if (t.kind === "number") {
      expr = { kind: "literal", value: Number(t.value) };
    } else if (t.kind === "string") {
      expr = { kind: "literal", value: t.value };
    } else if (t.kind === "punct" && t.value === "*") {
      expr = { kind: "star" };
    } else if (t.kind === "ident") {
      const upper = t.value.toUpperCase();
      if (upper === "NULL") expr = { kind: "literal", value: null };
      else if (upper === "TRUE") expr = { kind: "literal", value: 1 };
      else if (upper === "FALSE") expr = { kind: "literal", value: 0 };
      else expr = { kind: "ident", name: t.value };
    } else {
      throw new QueryError(`Unexpected token '${t.value}'.`);
    }
    // table.column or alias.column / alias.*
    if (this.peek()?.kind === "dot") {
      this.eat();
      const col = this.eat();
      if (expr.kind === "star") return { kind: "star", table: (expr as { kind: "star"; table?: string }).table ?? t.value };
      if (expr.kind !== "ident") throw new QueryError("Left side of '.' must be a name or *.");
      return { kind: "ident", table: t.value, name: col.value };
    }
    // function call: name([DISTINCT] args...)
    if (expr.kind === "ident" && this.peek()?.value === "(") {
      this.eat();
      const args: Expr[] = [];
      let distinct = false;
      if (!this.match(")")) {
        distinct = this.match("DISTINCT");
        do {
          args.push(this.parseExpr());
        } while (this.match(","));
        this.expect(")");
      }
      return { kind: "call", name: expr.name.toUpperCase(), args, distinct };
    }
    // arithmetic / comparison suffix
    return this.parseBinSuffix(expr);
  }

  private parseBinSuffix(left: Expr): Expr {
    const ops = new Set(["+", "-", "*", "/", "||"]);
    if (this.peek()?.kind === "op" && ops.has(this.peek()!.value)) {
      const op = this.eat().value;
      const right = this.parseExpr();
      return { kind: "bin", op, left, right };
    }
    return left;
  }
}

export function parse(sql: string): ParsedQuery {
  return new Parser().parse(sql);
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

function exprHasAggregate(e: Expr): boolean {
  if (e.kind === "call") {
    const name = e.name.toUpperCase();
    if (["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(name)) return true;
    return e.args.some(exprHasAggregate);
  }
  if (e.kind === "bin") return exprHasAggregate(e.left) || exprHasAggregate(e.right);
  if (e.kind === "alias") return exprHasAggregate(e.inner);
  return false;
}

interface ResolvedName {
  table: string;
  col: string;
  row: Row;
}

function resolveName(e: Expr & { kind: "ident" }, scopes: Scoped[]): ResolvedName {
  const wantTable = e.table?.toLowerCase();
  const wantCol = e.name.toLowerCase();
  for (const s of scopes) {
    // a scope may be a merged multi-table row (after a join): the scope's own
    // identity is the last-joined table, but its `row` may carry qualified
    // keys for earlier tables. `ownsTable` checks both the identity and the
    // row keys so `c.id` still resolves after merging customers into orders
    const ownsTable = (want: string) =>
      s.table.toLowerCase() === want ||
      s.alias?.toLowerCase() === want ||
      Object.keys(s.row).some(
        (k) => k.indexOf(".") >= 0 && k.slice(0, k.indexOf(".")).toLowerCase() === want
      );
    const belongs = !wantTable || ownsTable(wantTable);
    for (const [k, v] of Object.entries(s.row)) {
      void v;
      const dot = k.indexOf(".");
      let keyTable = dot >= 0 ? k.slice(0, dot).toLowerCase() : s.table.toLowerCase();
      const keyCol = dot >= 0 ? k.slice(dot + 1) : k;
      if (keyCol.toLowerCase() !== wantCol) continue;
      if (!belongs) continue;
      // an alias reference (e.g. `c.id`) matches qualified keys stored under
      // the physical table name, because the alias may differ from the table
      if (wantTable && keyTable !== wantTable && keyTable !== (s.alias ?? "").toLowerCase()) continue;
      if (dot < 0 && wantTable && keyTable === wantTable) {
        // unqualified key matched a qualified-looking reference — skip; the
        // qualified copy below (or the belongs path) is authoritative
      }
      return { table: keyTable, col: keyCol, row: s.row };
    }
    if (wantTable && belongs) {
      // qualified reference into this scope's table: qualified keys live
      // under `table.col`
      const qkey = `${e.table}.${e.name}`;
      for (const [k, v] of Object.entries(s.row)) {
        void v;
        if (k.toLowerCase() === qkey.toLowerCase()) {
          const dot = k.indexOf(".");
          return { table: k.slice(0, dot), col: k.slice(dot + 1), row: s.row };
        }
      }
    }
  }
  throw new QueryError(`Column not found: ${e.table ? `${e.table}.${e.name}` : e.name}`);
}

function evalCond(c: Cond, scopes: Scoped[], ctx?: { group?: Scoped[] }): boolean {
  switch (c.kind) {
    case "cmp": {
      const l = evalExprVal(c.left, scopes, ctx);
      const r = evalExprVal(c.right, scopes, ctx);
      return cmpBool(l, c.op, r);
    }
    case "and":
      return c.conds.every((cc) => evalCond(cc, scopes, ctx));
    case "or":
      return c.conds.some((cc) => evalCond(cc, scopes, ctx));
    case "not":
      return !evalCond(c.inner, scopes, ctx);
    case "in": {
      const v = evalExprVal(c.expr, scopes, ctx);
      const hit = c.values.some((vv) => cmpBool(v, "=", vv));
      return c.negate ? !hit : hit;
    }
    case "like": {
      const s = String(evalExprVal(c.expr, scopes, ctx) ?? "");
      const p = String(evalExprVal(c.pattern, scopes, ctx) ?? "");
      const hit = likeToRegex(p).test(s);
      return c.negate ? !hit : hit;
    }
    case "null": {
      const v = evalExprVal(c.expr, scopes, ctx);
      const hit = v === null || v === undefined;
      return c.negate ? !hit : hit;
    }
  }
}

function likeToRegex(p: string): RegExp {
  let re = "^";
  for (const ch of p) {
    if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$", "i");
}

function cmpBool(l: unknown, op: string, r: unknown): boolean {
  if (op === "=") {
    if (l === r) return true;
    return l == null && r == null;
  }
  if (op === "!=") return !cmpBool(l, "=", r);
  if (l == null || r == null) return false;
  const a = l as number | string;
  const b = r as number | string;
  if (op === "<") return a < b;
  if (op === ">") return a > b;
  if (op === "<=") return a <= b;
  if (op === ">=") return a >= b;
  return false;
}

function evalExprVal(e: Expr, scopes: Scoped[], ctx?: { group?: Scoped[] }): unknown {
  switch (e.kind) {
    case "literal":
      return e.value;
    case "ident": {
      try {
        const r = resolveName(e, scopes);
        return r.row[r.col] ?? null;
      } catch {
        return undefined;
      }
    }
    case "star":
      return null;
    case "alias":
      return evalExprVal(e.inner, scopes, ctx);
    case "call":
      return evalCall(e, scopes, ctx);
    case "bin": {
      const l = evalExprVal(e.left, scopes, ctx);
      const r = evalExprVal(e.right, scopes, ctx);
      if (e.op === "||") return `${l ?? ""}${r ?? ""}`;
      if (e.op === "+") return (Number(l) || 0) + (Number(r) || 0);
      if (e.op === "-") return (Number(l) || 0) - (Number(r) || 0);
      if (e.op === "*") return (Number(l) || 0) * (Number(r) || 0);
      if (e.op === "/") return Number(r) === 0 ? null : Number(l) / Number(r);
      return null;
    }
  }
}

function evalCall(
  e: { kind: "call"; name: string; args: Expr[]; distinct?: boolean },
  scopes: Scoped[],
  ctx?: { group?: Scoped[] }
): unknown {
  const name = e.name.toUpperCase();
  const group = ctx?.group ?? scopes;

  if (name === "COUNT") {
    if (e.args[0]?.kind === "star") return group.length;
    const arg = e.args[0];
    if (e.distinct) {
      const vals = new Set<unknown>();
      for (const s of group) {
        const v = evalExprVal(arg, [s]);
        if (v != null) vals.add(String(v));
      }
      return vals.size;
    }
    return group.filter((s) => evalExprVal(arg, [s]) != null).length;
  }

  // aggregate over the group
  const vals = group
    .map((s) => evalExprVal(e.args[0], [s]))
    .filter((v): v is number => v != null) as number[];

  if (name === "SUM") return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  if (name === "AVG") return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  if (name === "MIN") return vals.length ? Math.min(...vals) : null;
  if (name === "MAX") return vals.length ? Math.max(...vals) : null;

  // scalar functions over the representative row
  if (name === "ROUND") {
    const x = Number(evalExprVal(e.args[0], scopes, ctx));
    const d = e.args[1] ? Number(evalExprVal(e.args[1], scopes, ctx)) : 0;
    if (Number.isNaN(x)) return null;
    const f = Math.pow(10, d);
    return Math.round(x * f) / f;
  }
  if (name === "SUBSTR" || name === "SUBSTRING") {
    const raw = evalExprVal(e.args[0], scopes, ctx);
    const s = String(raw ?? "");
    const start = Math.max(0, Number(evalExprVal(e.args[1], scopes, ctx)) - 1);
    const len = e.args[2] ? Number(evalExprVal(e.args[2], scopes, ctx)) : undefined;
    return len === undefined ? s.slice(start) : s.slice(start, start + len);
  }
  if (name === "LOWER") return String(evalExprVal(e.args[0], scopes, ctx) ?? "").toLowerCase();
  if (name === "UPPER") return String(evalExprVal(e.args[0], scopes, ctx) ?? "").toUpperCase();
  if (name === "LENGTH") return String(evalExprVal(e.args[0], scopes, ctx) ?? "").length;
  if (name === "ABS") return Math.abs(Number(evalExprVal(e.args[0], scopes, ctx) ?? 0));
  if (name === "COALESCE") {
    for (const a of e.args) {
      const v = evalExprVal(a, scopes, ctx);
      if (v != null) return v;
    }
    return null;
  }
  throw new QueryError(`Unknown function: ${e.name}`);
}

function isAliasExpr(e: Expr): e is { kind: "alias"; inner: Expr; alias: string } {
  return (e as { kind?: string }).kind === "alias";
}

function exprOutputName(e: Expr): string {
  if (isAliasExpr(e)) return e.alias;
  if (e.kind === "ident") return e.table ? `${e.table}.${e.name}` : e.name;
  if (e.kind === "star") return e.table ? `${e.table}.*` : "*";
  if (e.kind === "call") {
    // render a readable name: SUM(o.total)
    const args = e.args.map((a) => exprOutputName(a)).join(", ");
    return `${e.name.toLowerCase()}(${args})`;
  }
  if (e.kind === "bin") return "expr";
  return String(e.value ?? "literal");
}

function aliasMapOf(select: Expr[]): Map<string, Expr> {
  const map = new Map<string, Expr>();
  for (const e of select) if (isAliasExpr(e)) map.set(e.alias.toLowerCase(), e.inner);
  return map;
}

function evalSelectExpr(
  e: Expr,
  rep: Scoped,
  tableList: { table: string; alias?: string }[],
  group: Scoped[],
  aliases: Map<string, Expr>
): unknown {
  if (isAliasExpr(e)) return evalSelectExpr(e.inner, rep, tableList, group, aliases);
  if (e.kind === "star") {
    const parts: unknown[] = [];
    const seen = new Set<string>();
    for (const t of tableList) {
      const cols = Object.keys(getTableData(t.table)[0] || {});
      for (const col of cols) {
        if (seen.has(col.toLowerCase())) continue;
        seen.add(col.toLowerCase());
        const src = group.find((s) => s.table === t.table) ?? rep;
        parts.push(src.row[col] ?? null);
      }
    }
    return parts;
  }
  if (e.kind === "ident") {
    // output alias resolution: `ORDER BY spend` or `GROUP BY month`
    const aliasInner = aliases.get(e.name.toLowerCase());
    if (aliasInner && !e.table) {
      return evalSelectExpr(aliasInner, rep, tableList, group, aliases);
    }
    try {
      const r = resolveName(e, [rep]);
      return r.row[r.col] ?? null;
    } catch {
      return null;
    }
  }
  return evalExprVal(e, [rep], { group });
}

export function execute(q: ParsedQuery): { columns: string[]; rows: unknown[][] } {
  const tableList: { table: string; alias?: string }[] = [
    { table: q.from.table, alias: q.from.alias },
    ...q.joins.map((j) => ({ table: j.table, alias: j.alias })),
  ];
  const select = expandWildcards(q.select, tableList);

  // 1. FROM + JOINs: nested-loop join filtered by the ON predicate.
  let scopes: Scoped[] = getTableData(q.from.table).map((row) => ({
    table: q.from.table,
    alias: q.from.alias,
    row: withQualifiedKeys(q.from.table, q.from.alias, row),
  }));
  for (let ji = 0; ji < q.joins.length; ji++) {
    const j = q.joins[ji];
    const jdata = getTableData(j.table);
    const isLeft = j.type === "LEFT JOIN";
    const cond = j.on;

    // Hash join when the ON predicate is a plain column equality
    // a.col = b.col (or reversed). Build the index on whichever side belongs
    // to the join table and probe with the other. Otherwise nested loop.
    const eq = eqColumnsOf(cond);
    const sideBelongs = (side: { table?: string }): boolean => {
      const name = side.table?.toLowerCase();
      if (!name) return false;
      // the referenced name may be the physical table name OR its alias
      return name === j.table.toLowerCase() || name === (j.alias ?? "").toLowerCase();
    };
    const hashJoin = eq && (sideBelongs(eq.a) || sideBelongs(eq.b));
  
    if (hashJoin && eq) {
      // Ensure `eq.a` is the join-table side; swap so probing uses the
      // carried scopes (left/outer) against the built index.
      if (!sideBelongs(eq.a)) {
        const tmp = eq.a;
        eq.a = eq.b;
        eq.b = tmp;
      }
      const probeCol = eq.b.col;
      // resolve the probe column in the carried scopes by matching the
      // column name against the outer table's columns (or its alias)
      const probeFromAlias = eq.b.table
        ? eq.b.table.toLowerCase()
        : q.from.table.toLowerCase();
      const index = new Map<unknown, Scoped[]>();
      for (const jr of jdata) {
        const key = jr[eq!.a.col] ?? null;
        let list = index.get(key);
        if (!list) {
          list = [];
          index.set(key, list);
        }
        list.push({ table: j.table, alias: j.alias, row: jr });
      }
      const next: Scoped[] = [];
      for (const left of scopes) {
        let key: unknown;
        const wantTable = left.table.toLowerCase();
        const wantAlias = (left.alias ?? left.table).toLowerCase();
        if (probeFromAlias === wantTable || probeFromAlias === wantAlias) {
          key = left.row[probeCol] ?? null;
        } else {
          key = evalExprVal({ kind: "ident", name: eq.b.col, table: eq.b.table }, [left]);
        }
        const hits = index.get(key ?? null) ?? [];
        if (hits.length) {
          for (const h of hits) next.push(mergeScope(left, h));
        } else if (isLeft) {
          const nullRow: Row = {};
          for (const col of Object.keys(jdata[0] || {})) nullRow[col] = null;
          next.push(mergeScope(left, { table: j.table, alias: j.alias, row: nullRow }));
        }
      }
      scopes = next;
    } else {
      const next: Scoped[] = [];
      for (const left of scopes) {
        let matched = false;
        for (const jr of jdata) {
          const right: Scoped = { table: j.table, alias: j.alias, row: jr };
          if (evalCond(cond, [left, right])) {
            next.push(mergeScope(left, right));
            matched = true;
          }
        }
        if (isLeft && !matched) {
          const nullRow: Row = {};
          for (const col of Object.keys(jdata[0] || {})) nullRow[col] = null;
          next.push(mergeScope(left, { table: j.table, alias: j.alias, row: nullRow }));
        }
      }
      scopes = next;
    }
  }

  // 2. WHERE
  if (q.where) {
    const where = q.where;
    scopes = scopes.filter((s) => evalCond(where, [s]));
  }

  // 3. GROUP BY
  const hasAgg = select.some(exprHasAggregate);
  let groups: { key: string; members: Scoped[] }[];
  const selectAliases = aliasMapOf(select);
  if (q.groupBy.length > 0) {
    const map = new Map<string, Scoped[]>();
    for (const s of scopes) {
      const parts = q.groupBy.map((ge) => {
        // GROUP BY may reference a SELECT alias (e.g. GROUP BY month)
        let aliasInner: Expr | undefined;
        if (ge.kind === "ident" && !ge.table) aliasInner = selectAliases.get(ge.name.toLowerCase());
        const resolved = aliasInner ? aliasInner : (ge as Expr & { kind: "ident" });
        if (resolved.kind === "ident") {
          const r = resolveName(resolved, [s]);
          return `${r.table}.${r.col}=${String(r.row[r.col])}`;
        }
        return String(evalExprVal(resolved, [s], { group: undefined as unknown as Scoped[] }));
      });
      const key = parts.join("|");
      let g = map.get(key);
      if (!g) {
        g = [];
        map.set(key, g);
      }
      g.push(s);
    }
    groups = Array.from(map.entries()).map(([key, members]) => ({ key, members }));
  } else if (hasAgg) {
    groups = [{ key: "_all", members: scopes }];
  } else {
    groups = scopes.map((s, i) => ({ key: String(i), members: [s] }));
  }

  // 4. HAVING
  if (q.having) {
    const having = q.having;
    groups = groups.filter((g) => evalCond(having, [g.members[0]], { group: g.members }));
  }

  // 5. SELECT — build aliases first so ORDER BY can resolve them
  const aliases = aliasMapOf(select);
  const columns = select.map(exprOutputName);

  const outRows: unknown[][] = [];
  for (const g of groups) {
    const rep = g.members[0];
    const values = select.map((e) => evalSelectExpr(e, rep, tableList, g.members, aliases));
    outRows.push(values);
  }

  // 6. ORDER BY
  if (q.orderBy.length > 0) {
    const indices = outRows.map((_, i) => i);
    indices.sort((a, b) => {
      for (const key of q.orderBy) {
        const va = resolveOrderValue(key.expr, outRows[a], columns, aliases);
        const vb = resolveOrderValue(key.expr, outRows[b], columns, aliases);
        const c = compareValues(va, vb);
        if (c !== 0) return key.desc ? -c : c;
      }
      return 0;
    });
    const ordered = indices.map((i) => outRows[i]);
    outRows.length = 0;
    outRows.push(...ordered);
  }

  // 7. DISTINCT
  if (q.distinct) {
    const seen = new Set<string>();
    const dedup: unknown[][] = [];
    for (const r of outRows) {
      const k = r.map((v) => String(v)).join("\u0000");
      if (!seen.has(k)) {
        seen.add(k);
        dedup.push(r);
      }
    }
    outRows.length = 0;
    outRows.push(...dedup);
  }

  // 8. LIMIT / OFFSET
  if (q.offset) outRows.splice(0, q.offset);
  if (q.limit !== undefined) outRows.length = Math.min(outRows.length, q.limit);

  return { columns, rows: outRows };
}

/** Replace SELECT * with concrete table columns before rows are projected.
 * Each generated expression is aliased so joined tables retain unique, stable
 * result-grid headers instead of producing a single array-valued '*' cell. */
function expandWildcards(
  select: Expr[],
  tableList: { table: string; alias?: string }[]
): Expr[] {
  const usedHeaders = new Set<string>();
  const expanded: Expr[] = [];

  for (const expression of select) {
    if (expression.kind !== "star") {
      expanded.push(expression);
      usedHeaders.add(exprOutputName(expression).toLowerCase());
      continue;
    }

    const tables = expression.table
      ? tableList.filter((item) =>
          [item.table, item.alias].filter(Boolean).some((name) => name!.toLowerCase() === expression.table!.toLowerCase())
        )
      : tableList;

    if (tables.length === 0) throw new QueryError(`Unknown table or alias in wildcard: ${expression.table}.*`);

    for (const item of tables) {
      const qualifier = item.alias ?? item.table;
      for (const column of Object.keys(getTableData(item.table)[0] ?? {})) {
        const baseHeader = column;
        const header = usedHeaders.has(baseHeader.toLowerCase()) ? `${qualifier}.${column}` : baseHeader;
        usedHeaders.add(header.toLowerCase());
        expanded.push({
          kind: "alias",
          inner: { kind: "ident", table: qualifier, name: column },
          alias: header,
        });
      }
    }
  }

  return expanded;
}

function resolveOrderValue(
  e: Expr,
  row: unknown[],
  columns: string[],
  aliases: Map<string, Expr>
): unknown {
  if (e.kind === "ident" && !e.table) {
    // prefer output column names, which already include aliases
    const idx = columns.findIndex((c) => c.toLowerCase() === e.name.toLowerCase());
    if (idx >= 0) return row[idx];
    const n = Number(e.name);
    if (!Number.isNaN(n) && n >= 1 && n <= columns.length) return row[n - 1];
  }
  if (e.kind === "literal") return e.value;
  return null;
}

/** Merge two scopes into one: plain keys from the outer, table-qualified
 *  keys from the join side so columns that share a name (e.g. both tables
 *  have an `id`) stay addressable as `t.col`. */
/** Duplicate each row key under its table-qualified and alias-qualified
 *  names so `t.col`, `alias.col`, and plain `col` all resolve. */
function withQualifiedKeys(table: string, alias: string | undefined, row: Row): Row {
  const out: Row = { ...row };
  for (const [k, v] of Object.entries(row)) {
    out[`${table}.${k}`] = v;
    if (alias && alias.toLowerCase() !== table.toLowerCase()) {
      out[`${alias}.${k}`] = v;
    }
  }
  return out;
}

function mergeScope(outer: Scoped, inner: Scoped): Scoped {
  const row: Row = {};
  // carry the outer row as plain keys, plus qualified copies for both sides
  // so references like `c.id` and `o.id` both resolve after a join.
  // outer/inner rows may already contain qualified copies — skip those.
  const plain = (k: string) => k.indexOf(".") < 0;
  for (const [k, v] of Object.entries(outer.row)) {
    if (!plain(k)) continue;
    row[k] = v;
    row[`${outer.table}.${k}`] = v;
    if (outer.alias && outer.alias.toLowerCase() !== outer.table.toLowerCase()) {
      row[`${outer.alias}.${k}`] = v;
    }
  }
  for (const [k, v] of Object.entries(inner.row)) {
    if (!plain(k)) continue;
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      // name collision — only the qualified copy survives
      row[`${inner.table}.${k}`] = v;
      if (inner.alias && inner.alias.toLowerCase() !== inner.table.toLowerCase()) {
        row[`${inner.alias}.${k}`] = v;
      }
    } else {
      row[k] = v;
      row[`${inner.table}.${k}`] = v;
      if (inner.alias && inner.alias.toLowerCase() !== inner.table.toLowerCase()) {
        row[`${inner.alias}.${k}`] = v;
      }
    }
  }
  return { table: inner.table, alias: inner.alias, row };
}

function eqColumnsOf(cond: Cond | undefined): { a: { table?: string; alias?: string; col: string }; b: { table?: string; alias?: string; col: string } } | null {
  if (!cond || cond.kind !== "cmp" || cond.op !== "=") return null;
  const l = identOfExpr(cond.left);
  const r = identOfExpr(cond.right);
  if (!l || !r) return null;
  return { a: l, b: r };
}

function identOfExpr(e: Expr): { table?: string; alias?: string; col: string } | null {
  if (e.kind !== "ident") return null;
  return { table: e.table ?? undefined, alias: undefined, col: e.name };
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
