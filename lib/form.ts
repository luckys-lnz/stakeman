// Team form and matchup context computed from completed games (no extra data source needed).
import { q, type Game, type Injury, type Prediction, type Team } from "./db";

export type Result = {
  id: string; date: string; season: number; oppId: string; home: boolean;
  pf: number; pa: number; win: boolean;
};

export type Form = {
  teamId: string;
  last: Result[];            // most recent first (up to 10)
  strip: { r: "W" | "L"; season: number; label: string }[]; // last 5, most recent LAST for reading left→right
  season: { w: number; l: number };
  home: { w: number; l: number };
  away: { w: number; l: number };
  l10: { w: number; l: number; ppg: number; oppg: number; margin: number; total: number } | null;
  streak: string | null;     // "W3" / "L2"
  restDays: number | null;   // full days off before this game
  b2b: boolean;
};

type Row = { id: string; season: number; start_time: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number };

/** Completed games (current + previous season) for a set of teams. */
export async function recentGames(teamIds: string[], minSeason: number) {
  const ids = [...new Set(teamIds)];
  if (!ids.length) return [] as Row[];
  const list = ids.join(",");
  return q<Row[]>(
    `games?select=id,season,start_time,home_team_id,away_team_id,home_score,away_score` +
      `&completed=eq.true&season_type=in.(2,3,5)&season=gte.${minSeason}` +
      `&or=(home_team_id.in.(${list}),away_team_id.in.(${list}))&order=start_time.desc&limit=3000`,
    300
  );
}

const toResult = (g: Row, teamId: string): Result => {
  const home = g.home_team_id === teamId;
  const pf = home ? g.home_score : g.away_score, pa = home ? g.away_score : g.home_score;
  return { id: g.id, date: g.start_time, season: g.season, oppId: home ? g.away_team_id : g.home_team_id, home, pf, pa, win: pf > pa };
};

export type GameRow_ = Row;
export function teamForm(teamId: string, rows: Row[], before: string, season: number, oppAbbr: (id: string) => string): Form {
  const played = rows
    .filter((g) => (g.home_team_id === teamId || g.away_team_id === teamId) && g.start_time < before)
    .map((g) => toResult(g, teamId)); // already newest first
  const last = played.slice(0, 10);
  const thisSeason = played.filter((r) => r.season === season);
  const rec = (l: Result[]) => ({ w: l.filter((r) => r.win).length, l: l.filter((r) => !r.win).length });

  let streak: string | null = null;
  if (thisSeason.length) {
    const first = thisSeason[0].win;
    let n = 0;
    for (const r of thisSeason) { if (r.win === first) n++; else break; }
    streak = `${first ? "W" : "L"}${n}`;
  }

  const l10 = last.length
    ? {
        ...rec(last),
        ppg: last.reduce((s, r) => s + r.pf, 0) / last.length,
        oppg: last.reduce((s, r) => s + r.pa, 0) / last.length,
        margin: last.reduce((s, r) => s + r.pf - r.pa, 0) / last.length,
        total: last.reduce((s, r) => s + r.pf + r.pa, 0) / last.length,
      }
    : null;

  let restDays: number | null = null, b2b = false;
  if (played.length) {
    const hours = (new Date(before).getTime() - new Date(played[0].date).getTime()) / 3600e3;
    restDays = Math.max(0, Math.floor(hours / 24 - 0.5)); // ~24h gap = 0 days rest
    b2b = hours < 36;
  }

  return {
    teamId, last,
    strip: played.slice(0, 5).reverse().map((r) => ({
      r: r.win ? "W" : "L", season: r.season,
      label: `${r.win ? "W" : "L"} ${r.pf}-${r.pa} ${r.home ? "vs" : "@"} ${oppAbbr(r.oppId)}`,
    })),
    season: rec(thisSeason),
    home: rec(thisSeason.filter((r) => r.home)),
    away: rec(thisSeason.filter((r) => !r.home)),
    l10, streak, restDays, b2b,
  };
}

export function headToHead(aId: string, bId: string, rows: Row[], before: string, n = 5) {
  return rows
    .filter((g) => g.start_time < before &&
      ((g.home_team_id === aId && g.away_team_id === bId) || (g.home_team_id === bId && g.away_team_id === aId)))
    .slice(0, n);
}

const pctTxt = (x: number) => `${Math.round(x * 100)}%`;
const lastName = (n: string) => n.split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(w)).slice(-1)[0] ?? n;

/** Plain-English reasons behind the numbers. Facts only — no hype. */
export function whyLines(g: Game, p: Prediction | undefined, away: Form, home: Form, h2h: Row[], injuries: Injury[]) {
  const A = g.away.abbr, H = g.home.abbr;
  const out: string[] = [];
  if (p) {
    const hp = Number(p.home_win_prob);
    const fav = hp >= 0.5 ? H : A, favP = Math.max(hp, 1 - hp);
    if (p.market_home_prob != null) {
      const mh = Number(p.market_home_prob);
      const mFav = mh >= 0.5 ? H : A, mP = Math.max(mh, 1 - mh);
      out.push(fav === mFav
        ? `Model and market agree ${fav} is the favorite: model ${pctTxt(favP)}, market ${pctTxt(mP)}.`
        : `Model leans ${fav} (${pctTxt(favP)}) while the market favors ${mFav} (${pctTxt(mP)}).`);
    } else {
      out.push(`Model makes ${fav} a ${pctTxt(favP)} favorite. No market line yet.`);
    }
    if (p.market_spread_home != null) {
      const ms = Number(p.market_spread_home), mod = -Number(p.exp_margin);
      const gap = ms - mod;
      if (Math.abs(gap) >= 1.5) out.push(`Model has ${H} at ${mod > 0 ? "+" : ""}${mod.toFixed(1)} vs the market's ${ms > 0 ? "+" : ""}${ms}: it rates ${gap > 0 ? H : A} ${Math.abs(gap).toFixed(1)} points better than the line does.`);
      else out.push(`Model spread (${H} ${mod > 0 ? "+" : ""}${mod.toFixed(1)}) is close to the market (${ms > 0 ? "+" : ""}${ms}), so no spread edge.`);
    }
  }
  // form
  if (away.l10 && home.l10) {
    const f = (t: string, x: Form) => `${t} ${x.l10!.w}-${x.l10!.l} in last ${x.l10!.w + x.l10!.l} (avg margin ${x.l10!.margin >= 0 ? "+" : ""}${x.l10!.margin.toFixed(1)})`;
    out.push(`Recent form: ${f(A, away)}; ${f(H, home)}.`);
  }
  const gpA = away.season.w + away.season.l, gpH = home.season.w + home.season.l;
  if (Math.min(gpA, gpH) < 5)
    out.push(`Early season: ${A} has played ${gpA} game${gpA === 1 ? "" : "s"} and ${H} ${gpH} this season, so last season still carries a lot of weight in the ratings and form.`);
  // rest
  if (away.b2b && !home.b2b) out.push(`${A} is on the second night of a back-to-back; ${H} has ${home.restDays ?? "?"} day(s) of rest.`);
  else if (home.b2b && !away.b2b) out.push(`${H} is on the second night of a back-to-back; ${A} has ${away.restDays ?? "?"} day(s) of rest.`);
  else if (away.b2b && home.b2b) out.push(`Both teams are on a back-to-back.`);
  else if (away.restDays != null && home.restDays != null && Math.abs(away.restDays - home.restDays) >= 2)
    out.push(`Rest edge: ${away.restDays > home.restDays ? A : H} has ${Math.max(away.restDays, home.restDays)} days off vs ${Math.min(away.restDays, home.restDays)}.`);
  // totals trend
  if (p?.market_total != null && away.l10 && home.l10) {
    out.push(`Totals: ${A} games average ${away.l10.total.toFixed(1)} points, ${H} games ${home.l10.total.toFixed(1)} (last 10) vs a line of ${p.market_total}.`);
  }
  // h2h
  if (h2h.length) {
    const aw = h2h.filter((x) => (x.home_team_id === g.away.id ? x.home_score > x.away_score : x.away_score > x.home_score)).length;
    out.push(`Head to head: ${A} ${aw}-${h2h.length - aw} vs ${H} in the last ${h2h.length} meetings.`);
  }
  // injuries
  const key = injuries.filter((i) => i.key);
  if (key.length) out.push(`Key absences: ${key.map((i) => `${lastName(i.name)} (${i.status === "Out" ? "out" : "questionable"})`).join(", ")}.`);
  // pick decision
  if (p) {
    const holds = (p.flags ?? []).filter((f) => f.endsWith("-inj"));
    if (holds.length) out.push(`Some picks are on injury hold: the model can't price the absence, so it stays out.`);
    if ((p.flags ?? []).includes("ml")) out.push(`The model and market disagree by more than the model can explain, usually news it can't see. No side pick: check news.`);
  }
  return out;
}

export function teamMap(teams: Team[]) {
  const m = new Map(teams.map((t) => [t.id, t]));
  return (id: string) => m.get(id)?.abbr ?? "?";
}
