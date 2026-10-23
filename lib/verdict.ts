// Turns a prediction into plain decisions: play / pass / hold / check news, with one-line reasons.
import type { Game, Injury, Prediction } from "./db";
import type { Form } from "./form";

export type Call = {
  market: "Moneyline" | "Spread" | "Total";
  status: "play" | "pass" | "hold" | "news" | "noline";
  pick: string | null;      // e.g. "NY +2.5"
  price: string | null;     // e.g. "+110" / "56%"
  reason: string;
  stars?: number;           // 1-5 confidence, from the size of the edge
  odds?: number;            // American odds used for the payout line
  win100?: number;          // profit on a $100 stake
};

const payout100 = (odds: number) => (odds > 0 ? odds : (100 * 100) / -odds);
/** Confidence from edge size. ML: blended edge in probability points; spread/total: blended win probability. */
export function starsFor(kind: "ml" | "prob", x: number) {
  const cuts = kind === "ml" ? [0.03, 0.04, 0.055, 0.07] : [0.5475, 0.555, 0.565, 0.58];
  return 1 + cuts.filter((c) => x >= c).length;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sgn = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${Number(x.toFixed(1))}`);
const am = (x: number | null) => (x == null ? null : `${x > 0 ? "+" : ""}${x}`);
const lastName = (n: string) => n.split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(w)).slice(-1)[0] ?? n;

export function calls(g: Game, p: Prediction | undefined, injuries: Injury[]): Call[] {
  const A = g.away.abbr, H = g.home.abbr;
  if (!p) return [];
  const flags = p.flags ?? [];
  const keyNames = (side: "home" | "away") =>
    injuries.filter((i) => i.key && i.team_id === (side === "home" ? g.home.id : g.away.id)).map((i) => lastName(i.name)).join(", ");
  const holdReason = (side: "home" | "away" | null) =>
    `Withheld: ${side ? `${side === "home" ? H : A} is missing ${keyNames(side) || "a key player"}` : "a key player is out"}, and the model can't price absences yet.`;
  const out: Call[] = [];

  // moneyline
  if (p.market_home_prob == null) out.push({ market: "Moneyline", status: "noline", pick: null, price: null, reason: "No line yet." });
  else {
    const mh = Number(p.market_home_prob), hp = Number(p.home_win_prob);
    if (p.ml_pick) {
      const side = p.ml_pick, t = side === "home" ? H : A;
      const o = Number(side === "home" ? p.market_ml_home : p.market_ml_away);
      out.push({ market: "Moneyline", status: "play", pick: `${t} to win`, price: am(o), odds: o, win100: payout100(o), stars: starsFor("ml", Number(p.ml_edge)),
        reason: `Market prices ${t} at ${pct(side === "home" ? mh : 1 - mh)}; Stakeman makes it ${pct(Number(p.ml_pick_prob))} after blending with the market.` });
    } else if (flags.includes("ml-inj")) out.push({ market: "Moneyline", status: "hold", pick: null, price: null, reason: holdReason(hp > mh ? "home" : "away") });
    else if (flags.includes("ml")) out.push({ market: "Moneyline", status: "news", pick: null, price: null,
      reason: `Model (${H} ${pct(hp)}) and market (${H} ${pct(mh)}) are too far apart. That usually means news the model can't see.` });
    else out.push({ market: "Moneyline", status: "pass", pick: null, price: null,
      reason: `Model ${H} ${pct(hp)} vs market ${pct(mh)}: not enough of a gap to beat the bookmaker's margin.` });
  }

  // spread
  if (p.market_spread_home == null) out.push({ market: "Spread", status: "noline", pick: null, price: null, reason: "No line yet." });
  else {
    const ms = Number(p.market_spread_home), mod = -Number(p.exp_margin);
    if (p.spread_pick) {
      const side = p.spread_pick, t = side === "home" ? H : A, line = side === "home" ? ms : -ms;
      out.push({ market: "Spread", status: "play", pick: `${t} ${sgn(line)}`, price: pct(Number(p.spread_pick_prob)), odds: -110, win100: payout100(-110), stars: starsFor("prob", Number(p.spread_pick_prob)),
        reason: `Line is ${H} ${sgn(ms)}, model has ${H} ${sgn(mod)}. ${t} covers about ${pct(Number(p.spread_pick_prob))} of the time.` });
    } else if (flags.includes("spread-inj")) out.push({ market: "Spread", status: "hold", pick: null, price: null, reason: holdReason(mod < ms ? "home" : "away") });
    else if (flags.includes("spread")) out.push({ market: "Spread", status: "news", pick: null, price: null,
      reason: `Model ${H} ${sgn(mod)} vs line ${sgn(ms)}: a gap this big usually means news the model can't see.` });
    else out.push({ market: "Spread", status: "pass", pick: null, price: null,
      reason: `Model ${H} ${sgn(mod)} vs line ${sgn(ms)}: within ${Math.abs(mod - ms).toFixed(1)} pts, no edge.` });
  }

  // total
  if (p.market_total == null) out.push({ market: "Total", status: "noline", pick: null, price: null, reason: "No line yet." });
  else {
    const tl = Number(p.market_total), et = Number(p.exp_total);
    if (p.total_pick) {
      out.push({ market: "Total", status: "play", pick: `${p.total_pick === "over" ? "Over" : "Under"} ${tl}`, price: pct(Number(p.total_pick_prob)), odds: -110, win100: payout100(-110), stars: starsFor("prob", Number(p.total_pick_prob)),
        reason: `Model projects ${et.toFixed(1)} points vs a line of ${tl}. ${p.total_pick === "over" ? "Over" : "Under"} hits about ${pct(Number(p.total_pick_prob))}.` });
    } else if (flags.includes("total-inj")) out.push({ market: "Total", status: "hold", pick: null, price: null, reason: holdReason(null) });
    else if (flags.includes("total")) out.push({ market: "Total", status: "news", pick: null, price: null,
      reason: `Model ${et.toFixed(1)} vs line ${tl}: too far apart to trust.` });
    else out.push({ market: "Total", status: "pass", pick: null, price: null,
      reason: `Model ${et.toFixed(1)} vs line ${tl}: within ${Math.abs(et - tl).toFixed(1)} pts, no edge.` });
  }
  return out;
}

export function headline(cs: Call[]) {
  const plays = cs.filter((c) => c.status === "play");
  if (!cs.length) return { title: "No prediction yet", sub: "Predictions appear for games in the next four days." };
  if (plays.length) return { title: plays.map((c) => c.pick).join(" · "), sub: `${plays.length} play${plays.length > 1 ? "s" : ""} on this game.` };
  if (cs.some((c) => c.status === "hold" || c.status === "news")) return { title: "No play", sub: "The model can't see everything that matters here. Check the notes below." };
  if (cs.every((c) => c.status === "noline")) return { title: "Waiting for lines", sub: "Picks appear once the market opens." };
  return { title: "No play", sub: "The model agrees with the market. There's no edge worth betting." };
}

/** Which team has the edge on each comparison, for the "edges" chart. */
export function edges(fa: Form, fh: Form, rankA: number | null, rankH: number | null) {
  type Row = { label: string; a: number; h: number; fmtA: string; fmtH: string; better: "high" | "low" };
  const rows: Row[] = [];
  if (fa.l10 && fh.l10) {
    rows.push({ label: "Scoring (pts, last 10)", a: fa.l10.ppg, h: fh.l10.ppg, fmtA: fa.l10.ppg.toFixed(1), fmtH: fh.l10.ppg.toFixed(1), better: "high" });
    rows.push({ label: "Defense (pts allowed, last 10)", a: fa.l10.oppg, h: fh.l10.oppg, fmtA: fa.l10.oppg.toFixed(1), fmtH: fh.l10.oppg.toFixed(1), better: "low" });
    rows.push({ label: "Avg margin (last 10)", a: fa.l10.margin, h: fh.l10.margin, fmtA: sgn(fa.l10.margin), fmtH: sgn(fh.l10.margin), better: "high" });
  }
  if (fa.restDays != null && fh.restDays != null)
    rows.push({ label: "Rest (days off)", a: fa.restDays, h: fh.restDays, fmtA: fa.b2b ? "B2B" : String(fa.restDays), fmtH: fh.b2b ? "B2B" : String(fh.restDays), better: "high" });
  if (rankA && rankH) rows.push({ label: "Power rank", a: rankA, h: rankH, fmtA: `#${rankA}`, fmtH: `#${rankH}`, better: "low" });
  return rows.map((r) => {
    const diff = r.better === "high" ? r.a - r.h : r.h - r.a;
    const tie = Math.abs(diff) < (r.label.startsWith("Rest") ? 1 : r.label.startsWith("Power") ? 1 : 1.5);
    return { ...r, edge: tie ? null : diff > 0 ? ("a" as const) : ("h" as const) };
  });
}
