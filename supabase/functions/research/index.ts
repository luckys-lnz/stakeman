// Stakeman research: how many points is an absence worth? Walk-forward, no peeking.
//  - replays the production Elo model game by game (params from model_versions)
//  - "fresh absence": a rotation player (played in 3+ of the team's last 5 games, 15+ min avg over his
//    last 20 for that team) who does not play in this game
//  - fits points-per-absence on 2024-25, tests on 2025-26 (margin error, Brier, and betting vs closing lines)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function loadAll(table: string, select: string, filter: (q: any) => any = (q) => q) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(sb.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
function erf(x: number) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const implied = (a: number) => a < 0 ? -a / (-a + 100) : 100 / (a + 100);
const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const NBA = /^([1-9]|[12][0-9]|30)$/;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const modelId = url.searchParams.get("model") ?? "stakeman-elo-v1.4";
  const minAvg = Number(url.searchParams.get("min") ?? 15);
  const { data: mv } = await sb.from("model_versions").select("params").eq("id", modelId).single();
  const p: any = mv!.params;

  const games = (await loadAll("games", "id,season,start_time,neutral,home_team_id,away_team_id,home_score,away_score",
    (q) => q.eq("completed", true).neq("season_type", 1).gte("season", 2024).order("start_time")))
    .filter((g: any) => NBA.test(g.home_team_id) && NBA.test(g.away_team_id) && g.home_score != null);
  const lines = new Map((await loadAll("game_lines_hist", "game_id,spread_home,total,ml_home,ml_away")).map((l: any) => [l.game_id, l]));
  const box = new Map<string, any[]>();
  for (const row of await loadAll("player_games", "game_id,team_id,player_id,minutes,pts,plus_minus,dnp")) {
    if (!box.has(row.game_id)) box.set(row.game_id, []);
    box.get(row.game_id)!.push(row);
  }

  // walk-forward state
  const elo: Record<string, number> = {}, off: Record<string, number> = {}, def: Record<string, number> = {};
  let lg = 114, cur: number | null = null;
  const ensure = (t: string) => { if (elo[t] == null) { elo[t] = 1500; off[t] = lg; def[t] = lg; } };
  const recentGames: Record<string, string[][]> = {};            // team -> last 5 games' player lists
  const plog: Record<string, { team: string; g: { min: number; pts: number; pm: number }[] }> = {}; // last 20 for current team
  const rows: any[] = [];

  for (const g of games) {
    if (g.season !== cur) {
      for (const t in elo) { elo[t] = p.carry * elo[t] + (1 - p.carry) * 1505; off[t] = lg + p.pcarry * (off[t] - lg); def[t] = lg + p.pcarry * (def[t] - lg); }
      cur = g.season;
    }
    const H = g.home_team_id, A = g.away_team_id;
    ensure(H); ensure(A);
    const diff = elo[H] - elo[A] + (g.neutral ? 0 : p.hca);
    const pr = 1 / (1 + Math.pow(10, -diff / 400)), em = diff / p.ppe;
    const eh = lg + (off[H] - lg) + (def[A] - lg) + (g.neutral ? 0 : p.hpts / 2);
    const ea = lg + (off[A] - lg) + (def[H] - lg) - (g.neutral ? 0 : p.hpts / 2);

    const b = box.get(g.id) ?? [];
    const played = new Set(b.filter((x) => !x.dnp && Number(x.minutes) > 0).map((x) => x.player_id));
    // fresh absences per team, from information before tip
    const lost: Record<string, { min: number; pts: number; pm: number; n: number; key: number; names: string[] }> = {};
    for (const t of [H, A]) {
      lost[t] = { min: 0, pts: 0, pm: 0, n: 0, key: 0, names: [] };
      const last5 = recentGames[t] ?? [];
      if (!b.length || last5.length < 3) continue;
      const counts: Record<string, number> = {};
      for (const ps of last5) for (const pid of ps) counts[pid] = (counts[pid] ?? 0) + 1;
      for (const [pid, c] of Object.entries(counts)) {
        if (c < 3 || played.has(pid)) continue;
        const L = plog[pid]; if (!L || L.team !== t || L.g.length < 5) continue;
        const mpg = L.g.reduce((s, x) => s + x.min, 0) / L.g.length;
        if (mpg < minAvg) continue;
        lost[t].min += mpg;
        lost[t].pts += L.g.reduce((s, x) => s + x.pts, 0) / L.g.length;
        lost[t].pm += L.g.reduce((s, x) => s + x.pm, 0) / L.g.length;
        lost[t].n++;
        if (mpg >= 28 && L.g.reduce((s, x) => s + x.pts, 0) / L.g.length >= 15) lost[t].key++;
      }
    }
    const margin = g.home_score - g.away_score, tot = g.home_score + g.away_score;
    rows.push({ season: g.season, id: g.id, date: g.start_time, em, pr, et: eh + ea, margin, tot, win: margin > 0 ? 1 : 0,
      lostH: lost[H], lostA: lost[A], hasBox: b.length > 0, line: lines.get(g.id) ?? null });

    // updates (identical to production)
    const win = margin > 0 ? 1 : 0, md = win ? diff : -diff;
    const d = p.k * (Math.pow(Math.abs(margin) + 3, 0.8) / (7.5 + 0.006 * md)) * (win - pr);
    elo[H] += d; elo[A] -= d;
    const al = p.alpha;
    off[H] = (1 - al) * off[H] + al * g.home_score; def[H] = (1 - al) * def[H] + al * g.away_score;
    off[A] = (1 - al) * off[A] + al * g.away_score; def[A] = (1 - al) * def[A] + al * g.home_score;
    lg = 0.99 * lg + 0.01 * tot / 2;
    for (const t of [H, A]) {
      const ps = b.filter((x) => x.team_id === t && !x.dnp && Number(x.minutes) > 0);
      if (!ps.length) continue;
      (recentGames[t] ??= []).push(ps.map((x) => x.player_id));
      if (recentGames[t].length > 5) recentGames[t].shift();
      for (const x of ps) {
        if (!plog[x.player_id] || plog[x.player_id].team !== t) plog[x.player_id] = { team: t, g: [] };
        plog[x.player_id].g.push({ min: Number(x.minutes), pts: Number(x.pts ?? 0), pm: Number(x.plus_minus ?? 0) });
        if (plog[x.player_id].g.length > 20) plog[x.player_id].g.shift();
      }
    }
  }

  // ---- fit: residual margin vs net lost production (fit 2024-25, test 2025-26)
  const feats = {
    minutes: (x: any) => x.lostA.min - x.lostH.min,            // + favors home (away is missing more)
    points: (x: any) => x.lostA.pts - x.lostH.pts,
    players: (x: any) => x.lostA.n - x.lostH.n,
  } as Record<string, (x: any) => number>;
  const train = rows.filter((x) => x.season === 2025 && x.hasBox), test = rows.filter((x) => x.season === 2026 && x.hasBox);
  const fitK = (f: (x: any) => number, set: any[]) => { let sxy = 0, sxx = 0; for (const x of set) { const z = f(x), y = x.margin - x.em; sxy += z * y; sxx += z * z; } return sxx ? sxy / sxx : 0; };
  const evalMargin = (f: (x: any) => number, k: number, set: any[]) => {
    let se = 0, br = 0;
    for (const x of set) { const e = x.em + k * f(x); se += (x.margin - e) ** 2; const pa = 1 / (1 + Math.pow(10, -(e * p.ppe) / 400)); br += (pa - x.win) ** 2; }
    return { rmse: r(Math.sqrt(se / set.length), 3), brier: r(br / set.length) };
  };
  const fits: any = {};
  for (const [name, f] of Object.entries(feats)) {
    const k = fitK(f, train);
    fits[name] = { k_per_unit: r(k, 4), test_2025_26: evalMargin(f, k, test), baseline_2025_26: evalMargin(f, 0, test),
      also_fit_on_test: r(fitK(f, test), 4) };
  }
  // totals: does missing production lower scoring?
  const tf = (x: any) => x.lostA.pts + x.lostH.pts;
  const kt = (() => { let sxy = 0, sxx = 0; for (const x of train) { const z = tf(x), y = x.tot - x.et; sxy += z * y; sxx += z * z; } return sxx ? sxy / sxx : 0; })();

  // ---- betting backtest on 2025-26+ games with closing lines, same rules as production
  const backtest = (adj: (x: any) => number, totalAdj: (x: any) => number, withTotals: boolean) => {
    const t = { ml: { w: 0, l: 0, u: 0 }, spread: { w: 0, l: 0, p: 0, u: 0 }, total: { w: 0, l: 0, p: 0, u: 0 }, games: 0 };
    const w = p.blend_w;
    for (const x of rows) {
      const L = x.line; if (!L || L.spread_home == null || x.season < 2026) continue;
      t.games++;
      const em = x.em + adj(x), pm = 1 / (1 + Math.pow(10, -(em * p.ppe) / 400));
      const sp = Number(L.spread_home);
      let gap = Math.abs(em + sp) > p.max_spread_gap;
      if (L.ml_home != null && L.ml_away != null) {
        const ih = implied(Number(L.ml_home)), ia = implied(Number(L.ml_away)); const mh = ih / (ih + ia);
        if (Math.abs(pm - mh) > p.max_ml_gap) gap = true;
        const edge = w * (pm - mh);
        if (!gap && Math.abs(edge) >= p.ml_edge_min) {
          const home = edge > 0, price = Number(home ? L.ml_home : L.ml_away), won = home ? x.margin > 0 : x.margin < 0;
          if (won) { t.ml.w++; t.ml.u += price > 0 ? price / 100 : 100 / -price; } else { t.ml.l++; t.ml.u -= 1; }
        }
      }
      if (!gap) {
        const bm = w * em + (1 - w) * -sp, hc = phi((bm + sp) / p.margin_sd);
        const side = hc >= p.ats_min_prob ? 1 : 1 - hc >= p.ats_min_prob ? -1 : 0;
        if (side) { const res = (x.margin + sp) * side; if (res > 0) { t.spread.w++; t.spread.u += 100 / 110; } else if (res < 0) { t.spread.l++; t.spread.u -= 1; } else t.spread.p++; }
      }
      if (withTotals && L.total != null) {
        const tl = Number(L.total), et = x.et + totalAdj(x);
        if (Math.abs(et - tl) <= p.max_total_gap) {
          const ov = 1 - phi((tl - (w * et + (1 - w) * tl)) / p.total_sd);
          const side = ov >= 0.54 ? 1 : 1 - ov >= 0.54 ? -1 : 0;
          if (side) { const res = (x.tot - tl) * side; if (res > 0) { t.total.w++; t.total.u += 100 / 110; } else if (res < 0) { t.total.l++; t.total.u -= 1; } else t.total.p++; }
        }
      }
    }
    for (const m of ["ml", "spread", "total"] as const) (t as any)[m].u = r((t as any)[m].u, 2);
    const n = t.ml.w + t.ml.l + t.spread.w + t.spread.l + t.spread.p;
    return { ...t, ml_spread_units: r(t.ml.u + t.spread.u, 2), ml_spread_picks: n, roi: n ? r((t.ml.u + t.spread.u) / n, 4) : null };
  };
  const kMin = fits.minutes.k_per_unit, kPts = fits.points.k_per_unit;
  const betting = {
    baseline: backtest(() => 0, () => 0, true),
    adj_minutes: backtest((x) => kMin * feats.minutes(x), (x) => kt * tf(x), true),
    adj_points: backtest((x) => kPts * feats.points(x), (x) => kt * tf(x), true),
    adj_points_half: backtest((x) => 0.5 * kPts * feats.points(x), () => 0, false),
    adj_points_x1_5: backtest((x) => 1.5 * kPts * feats.points(x), () => 0, false),
  };
  // ---- split the baseline (no adjustment) picks by whether the picked side was short-handed
  const split = () => {
    const B: Record<string, { w: number; l: number; u: number }> = {};
    const add = (k: string, won: boolean, profit: number) => { const b = (B[k] ??= { w: 0, l: 0, u: 0 }); if (won) { b.w++; b.u += profit; } else { b.l++; b.u -= 1; } };
    const w = p.blend_w;
    for (const x of rows) {
      const L = x.line; if (!L || L.spread_home == null || x.season < 2026) continue;
      const em = x.em, pm = x.pr, sp = Number(L.spread_home);
      let gap = Math.abs(em + sp) > p.max_spread_gap;
      const bucket = (side: "home" | "away") => {
        const mine = side === "home" ? x.lostH : x.lostA, theirs = side === "home" ? x.lostA : x.lostH;
        return mine.key > 0 ? "picked_side_missing_key_player" : theirs.key > 0 ? "opponent_missing_key_player" : "no_key_absence";
      };
      if (L.ml_home != null && L.ml_away != null) {
        const ih = implied(Number(L.ml_home)), ia = implied(Number(L.ml_away)); const mh = ih / (ih + ia);
        if (Math.abs(pm - mh) > p.max_ml_gap) gap = true;
        const edge = w * (pm - mh);
        if (!gap && Math.abs(edge) >= p.ml_edge_min) {
          const home = edge > 0, price = Number(home ? L.ml_home : L.ml_away);
          add("ml/" + bucket(home ? "home" : "away"), home ? x.margin > 0 : x.margin < 0, price > 0 ? price / 100 : 100 / -price);
        }
      }
      if (!gap) {
        const bm = w * em + (1 - w) * -sp, hc = phi((bm + sp) / p.margin_sd);
        const side = hc >= p.ats_min_prob ? 1 : 1 - hc >= p.ats_min_prob ? -1 : 0;
        const res = (x.margin + sp) * side;
        if (side && res !== 0) add("spread/" + bucket(side > 0 ? "home" : "away"), res > 0, 100 / 110);
      }
    }
    for (const k in B) (B[k] as any).u = r(B[k].u, 2);
    return B;
  };
  // ---- luck check: how often would coin-flip picks at the same prices do this well? (bootstrap the sign of each bet)
  const luck = () => {
    const bets: { profit: number }[] = [];
    const w = p.blend_w;
    for (const x of rows) {
      const L = x.line; if (!L || L.spread_home == null || x.season < 2026) continue;
      const sp = Number(L.spread_home); let gap = Math.abs(x.em + sp) > p.max_spread_gap;
      if (L.ml_home != null && L.ml_away != null) {
        const ih = implied(Number(L.ml_home)), ia = implied(Number(L.ml_away)); const mh = ih / (ih + ia);
        if (Math.abs(x.pr - mh) > p.max_ml_gap) gap = true;
        const edge = w * (x.pr - mh);
        if (!gap && Math.abs(edge) >= p.ml_edge_min) { const home = edge > 0, price = Number(home ? L.ml_home : L.ml_away), q = implied(price) / (implied(Number(L.ml_home)) + implied(Number(L.ml_away))) ;
          bets.push({ profit: (home ? x.margin > 0 : x.margin < 0) ? (price > 0 ? price / 100 : 100 / -price) : -1, ...{ fair: q, price } } as any); }
      }
      if (!gap) { const bm = w * x.em + (1 - w) * -sp, hc = phi((bm + sp) / p.margin_sd); const side = hc >= p.ats_min_prob ? 1 : 1 - hc >= p.ats_min_prob ? -1 : 0;
        const res = (x.margin + sp) * side; if (side && res !== 0) bets.push({ profit: res > 0 ? 100 / 110 : -1, fair: 0.5, price: -110 } as any); }
    }
    const actual = bets.reduce((s, b) => s + b.profit, 0);
    // simulate: each bet wins with its fair (vig-free) probability
    let seed = 12345; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let atLeast = 0; const N = 4000;
    for (let i = 0; i < N; i++) {
      let s = 0; for (const b of bets as any[]) { const winP = b.fair; s += rand() < winP ? (b.price > 0 ? b.price / 100 : 100 / -b.price) : -1; }
      if (s >= actual) atLeast++;
    }
    return { bets: bets.length, actual_units: r(actual, 2), share_of_random_seasons_this_good_or_better: r(atLeast / N, 3) };
  };

  // how often absences happen
  const withAbs = test.filter((x) => x.lostH.n + x.lostA.n > 0).length;
  const result = {
    model: modelId, min_avg_minutes: minAvg,
    coverage: { games: rows.length, train_2024_25: train.length, test_2025_26: test.length, test_games_with_a_fresh_absence: withAbs },
    avg_lost_per_team_game: { minutes: r(test.reduce((s, x) => s + x.lostH.min + x.lostA.min, 0) / (2 * test.length), 2), points: r(test.reduce((s, x) => s + x.lostH.pts + x.lostA.pts, 0) / (2 * test.length), 2) },
    fits, totals_k_per_lost_point: r(kt, 4), betting, baseline_split: split(), luck: luck(),
  };
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
});
