/**
 * Ledger Light — SQL Query Runner
 * Left rail: schema browser. Table names with row counts and per-table
 * column lists, mirroring a data catalog's object explorer (an intentional
 * nod to the kind of product Atlan builds).
 */

import { SUPPORTED_SQL, TABLES, type TableMeta } from "@/lib/catalog";
import { Table2, ChevronDown, BookOpen } from "lucide-react";
import { useState } from "react";

interface Props {
  counts: Record<string, number>;
  onInsertTable: (sql: string) => void;
  onLoadSample: (label: string, sql: string) => void;
  samples: { label: string; sql: string }[];
  className?: string;
}

export default function SchemaSidebar({ counts, onInsertTable, onLoadSample, samples, className = "" }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ orders: true });

  const toggle = (name: string) => setOpen((s) => ({ ...s, [name]: !s[name] }));

  return (
    <aside className={`w-64 shrink-0 border-r border-border/70 flex flex-col overflow-hidden bg-sidebar/80 ${className}`}>
      <div className="px-4 py-3 border-b border-border/60">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"><span className="h-1.5 w-1.5 bg-primary" aria-hidden="true" />Schema</h2>
      </div>
      <div className="overflow-y-auto flex-1 py-2">
        {TABLES.map((t: TableMeta) => (
          <div key={t.name}>
            <button
              onClick={() => toggle(t.name)}
              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-accent/50 transition-colors duration-150"
              aria-expanded={!!open[t.name]}
            >
              <Table2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="font-mono text-[13px] truncate">{t.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground font-mono shrink-0">
                {counts[t.name]?.toLocaleString("en-US") ?? "…"}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${open[t.name] ? "" : "-rotate-90"}`}
              />
            </button>
            {open[t.name] && (
              <div className="pl-10 pr-3 pb-2 space-y-0.5">
                {t.columns.map((col) => (
                  <button
                    key={col}
                    onClick={() => onInsertTable(`${t.name}.${col}`)}
                    className="block w-full text-left font-mono text-[12px] text-muted-foreground hover:text-foreground py-0.5 transition-colors duration-100"
                  >
                    {col}
                  </button>
                ))}
                <div className="pt-1 text-[11px] text-muted-foreground/70 leading-snug">{t.description}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border/60">
        <div className="px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Sample queries</h2>
        </div>
        <div className="overflow-y-auto max-h-48 pb-2 px-2 space-y-0.5">
          {samples.map((s) => (
            <button
              key={s.label}
              onClick={() => onLoadSample(s.label, s.sql)}
              className="block w-full text-left text-[12px] px-2 py-1.5 rounded hover:bg-accent/60 transition-colors duration-150 truncate"
              title={s.sql}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <details className="border-t border-border/60 shrink-0 group">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60">
          <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Supported SQL
          <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="max-h-52 overflow-y-auto px-4 pb-3 space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground">This browser engine intentionally accepts read-only SELECT statements only.</p>
          {SUPPORTED_SQL.map((item) => (
            <div key={item.title} className="border-l border-primary/35 pl-2">
              <h3 className="font-mono text-[11px] text-foreground">{item.title}</h3>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </details>
    </aside>
  );
}
