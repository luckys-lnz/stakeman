// Small, dependency-free charts built from HTML/CSS so they stay legible at phone width.
import type { Result } from "@/lib/form";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Two-way split bars: who wins, per source (model vs market). */
export function ProbSplit({ away, home, rows }: { away: string; home: string; rows: { label: string; home: number }[] }) {
  return (
    <div className="psplit">
      {rows.map((r) => (
        <div className="prow" key={r.label}>
          <span className="plabel">{r.label}</span>
          <div className="pbar" role="img" aria-label={`${r.label}: ${away} ${Math.round((1 - r.home) * 100)}%, ${home} ${Math.round(r.home * 100)}%`}>
            <span className={`seg a ${r.home < 0.5 ? "lead" : ""}`} style={{ width: `${(1 - r.home) * 100}%` }} title={`${away} ${(100 - r.home * 100).toFixed(1)}%`}>
              {away} {Math.round((1 - r.home) * 100)}%
            </span>
            <span className={`seg h ${r.home >= 0.5 ? "lead" : ""}`} style={{ width: `${r.home * 100}%` }} title={`${home} ${(r.home * 100).toFixed(1)}%`}>
              {home} {Math.round(r.home * 100)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A number line: market (square) and model (dot) are labelled on the line; reference marks are rings explained in a key. */
export function NumberLine({ min, max, marks, left, right }: {
  min: number; max: number; left?: string; right?: string;
  marks: { v: number; label: string; kind: "market" | "model" | "ref" }[];
}) {
  const x = (v: number) => `${clamp(((v - min) / (max - min)) * 100, 0, 100)}%`;
  const mk = marks.filter((m) => m.kind !== "ref");
  const refs = marks.filter((m) => m.kind === "ref");
  const lo = Math.min(...mk.map((m) => m.v)), hi = Math.max(...mk.map((m) => m.v));
  const n = (v: number) => Number(v.toFixed(1));
  return (
    <div className="nline">
      <div className="ntrack">
        {mk.length === 2 && <span className="ngap" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />}
        {refs.map((m, i) => (
          <span key={`r${i}`} className="nmark ref" style={{ left: x(m.v) }} title={`${m.label}: ${n(m.v)}`}><i /></span>
        ))}
        {mk.map((m, i) => (
          <span key={i} className={`nmark ${m.kind} ${m.kind === "market" ? "above" : "below"}`} style={{ left: x(m.v) }} title={`${m.label}: ${n(m.v)}`}>
            <i />
            <em>{m.label}<b>{n(m.v)}</b></em>
          </span>
        ))}
      </div>
      <div className="nends"><span>{n(min)}{left ? ` · ${left}` : ""}</span><span>{right ? `${right} · ` : ""}{n(max)}</span></div>
      {refs.length > 0 && (
        <div className="nkey">{refs.map((m, i) => <span key={i}><i /> {m.label} {n(m.v)}</span>)}</div>
      )}
    </div>
  );
}

/** Last-10 margins: wins up (blue), losses down (orange); last season faded, divider at the season change. */
export function MarginBars({ results, season, opp }: { results: Result[]; season: number; opp: (id: string) => string }) {
  const list = [...results].reverse(); // oldest → newest
  const cap = 30;
  return (
    <div className="mbars" role="img" aria-label={list.map((r) => `${r.win ? "W" : "L"} by ${Math.abs(r.pf - r.pa)}`).join(", ")}>
      {list.map((r, i) => {
        const m = r.pf - r.pa, h = (Math.min(Math.abs(m), cap) / cap) * 100;
        const boundary = i > 0 && list[i - 1].season !== r.season;
        return (
          <div key={r.id} className={`mcol ${r.season !== season ? "old" : ""} ${boundary ? "boundary" : ""}`}
            title={`${r.win ? "W" : "L"} ${r.pf}-${r.pa} ${r.home ? "vs" : "@"} ${opp(r.oppId)} (${new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })})`}>
            <div className="mup">{m > 0 && <span className="mb w" style={{ height: `${h}%` }} />}</div>
            <div className="mdown">{m < 0 && <span className="mb l" style={{ height: `${h}%` }} />}</div>
            <span className={`mlab ${r.win ? "w" : "l"}`}>{r.win ? "W" : "L"}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Paired comparison rows with the edge called out. */
export function EdgeRows({ away, home, rows }: {
  away: string; home: string;
  rows: { label: string; a: number; h: number; fmtA: string; fmtH: string; better: "high" | "low"; edge: "a" | "h" | null }[];
}) {
  return (
    <div className="edges">
      <div className="ehead"><span>{away}</span><span /><span>{home}</span></div>
      {rows.map((r) => {
        // bar length: share of the pair, so the better side is visibly longer
        const score = (v: number) => (r.better === "high" ? v : -v);
        const sa = score(r.a), sh = score(r.h);
        const lo = Math.min(sa, sh), span = Math.max(Math.abs(sa - sh), 1e-6);
        const len = (s: number) => 35 + ((s - lo) / span) * 65; // 35–100%
        return (
          <div className="erow" key={r.label}>
            <div className="eside l">
              <span className="eval">{r.fmtA}</span>
              <span className={`ebar ${r.edge === "a" ? "on" : ""}`} style={{ width: `${r.edge ? len(sa) : 60}%` }} />
            </div>
            <div className="elabel">
              {r.label}
              <small>{r.edge ? `edge ${r.edge === "a" ? away : home}` : "even"}</small>
            </div>
            <div className="eside r">
              <span className={`ebar ${r.edge === "h" ? "on" : ""}`} style={{ width: `${r.edge ? len(sh) : 60}%` }} />
              <span className="eval">{r.fmtH}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
