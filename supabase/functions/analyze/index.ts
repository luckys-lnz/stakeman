// Stakeman analysis: walk-forward Elo over history, joined with closing lines and box-score absences.
//  1) pick backtest: v1.1 pick rules vs real DraftKings closing lines (2025-26)
//  2) injury value: how much the Elo margin residual moves per point of "missing production"
// Writes results to public.analysis_runs (one JSON row per run).
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
const payout = (a: number) => a > 0 ? a / 100 : 100 / -a;
const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const modelId = url.searchParams.get("model") ?? "stakeman-elo-v1.1";
  const { data: mv } = await sb.from("model_versions").select("params").eq("id", modelId).single();
  const p: any = mv!.params;
  const kGrid = (url.searchParams.get("k") ?? "0,0.1,0.2,0.3,0.4,0.5,0.6").split(",").map(Number);

  const games = await loadAll("games", "id,season,season_type,start_time,neutral,home_team_id,away_team_id,home_score,away_score",
    (q) => q.eq("completed", true).neq("season_type", 1).gte("season", 2024).order("start_time"));
  const lines = new Map((await loadAll("game_lines_hist", "*")).map((l: any) => [l.game_id, l]));
  const pg = await loadAll("player_games", "game_id,team_id,player_id,minutes,pts,dnp");
  const byGame = new Map<string, any[]>();
  for (const row of pg) { if (!byGame.has(row.game_id)) byGame.set(row.game_id, []); byGame.get(row.game_id)!.push(row); }

  // walk-forward state
  const elo: Record<string, number> = {}, off: Record<string, number> = {}, def: Record<string, number> = {};
  // player rolling production (prior games only, current season)
  const ps: Record<string, { g: number; min: number; pts: number; season: number; team: string }> = {};
  let lg = 114, cur: number | null = null;
  const ensure = (t: string) => { if (elo[t] == null) { elo[t] = 1500; off[t] = lg; def[t] = lg; } };
  const rows: any[] = [];

  for (const g of games) {
    if (g.home_score == null || g.away_score == null) continue;
    if (g.season !== cur) {
      for (const t in elo) { elo[t] = p.carry * elo[t] + (1 - p.carry) * 1505; off[t] = lg + p.pcarry * (off[t] - lg); def[t] = lg + p.pcarry * (def[t] - lg); }
      cur = g.season;
    }
    ensure(g.home_team_id); ensure(g.away_team_id);
    const diff = elo[g.home_team_id] - elo[g.away_team_id] + (g.neutral ? 0 : p.hca);
    const pr = 1 / (1 + Math.pow(10, -diff / 400));
    const em = diff / p.ppe;
    const eh = lg + (off[g.home_team_id] - lg) + (def[g.away_team_id] - lg) + (g.neutral ? 0 : p.hpts / 2);
    const ea = lg + (off[g.away_team_id] - lg) + (def[g.home_team_id] - lg) - (g.neutral ? 0 : p.hpts / 2);

    // missing production: regulars (prior avg >= 20 min over >= 5 games this season, same team) who did not play
    const box = byGame.get(g.id) ?? [];
    const played = new Set(box.filter((b) => !b.dnp && Number(b.minutes) > 0).map((b) => b.player_id));
    const lost = { [g.home_team_id]: 0, [g.away_team_id]: 0 } as Record<string, number>;
    const lostMin = { [g.home_team_id]: 0, [g.away_team_id]: 0 } as Record<string, number>;
    if (box.length) {
      for (const [pid, s] of Object.entries(ps)) {
        if (s.season !== g.season || s.g < 5 || (s.team !== g.home_team_id && s.team !== g.away_team_id)) continue;
        const mpg = s.min / s.g;
        if (mpg < 20 || played.has(pid)) continue;
        // only count if the player is still on this roster (appears in this box score as DNP) or was listed recently
        const listed = box.find((b) => b.player_id === pid);
        if (!listed) continue;
        lost[s.team] += s.pts / s.g; lostMin[s.team] += mpg;
      }
    }
    const margin = g.home_score - g.away_score, tot = g.home_score + g.away_score;
    const line = lines.get(g.id);
    rows.push({ season: g.season, id: g.id, p: pr, em, et: eh + ea, margin, tot, win: margin > 0 ? 1 : 0,
      lostH: lost[g.home_team_id], lostA: lost[g.away_team_id], hasBox: box.length > 0, line });

    // updates
    const win = margin > 0 ? 1 : 0, md = win ? diff : -diff;
    const d = p.k * (Math.pow(Math.abs(margin) + 3, 0.8) / (7.5 + 0.006 * md)) * (win - pr);
    elo[g.home_team_id] += d; elo[g.away_team_id] -= d;
    const al = p.alpha;
    off[g.home_team_id] = (1 - al) * off[g.home_team_id] + al * g.home_score; def[g.home_team_id] = (1 - al) * def[g.home_team_id] + al * g.away_score;
    off[g.away_team_id] = (1 - al) * off[g.away_team_id] + al * g.away_score; def[g.away_team_id] = (1 - al) * def[g.away_team_id] + al * g.home_score;
    lg = 0.99 * lg + 0.01 * tot / 2;
    for (const b of box) {
      if (b.dnp || !(Number(b.minutes) > 0)) continue;
      const s = ps[b.player_id];
      if (!s || s.season !== g.season || s.team !== b.team_id) ps[b.player_id] = { g: 0, min: 0, pts: 0, season: g.season, team: b.team_id };
      const t = ps[b.player_id]; t.g++; t.min += Number(b.minutes); t.pts += Number(b.pts ?? 0);
    }
  }

  // ---- 2) injury value: margin residual vs net lost production (fit on 2024-25, test on 2025-26)
  const withBox = rows.filter((x) => x.hasBox && x.season >= 2025);
  const fit = (set: any[]) => { // least squares slope through origin: resid = k * (lostA - lostH)
    let sxy = 0, sxx = 0; for (const x of set) { const z = x.lostA - x.lostH; const y = x.margin - x.em; sxy += z * y; sxx += z * z; }
    return sxx ? sxy / sxx : 0; };
  const kTrain = fit(withBox.filter((x) => x.season === 2025));
  const kAll = fit(withBox);
  const evalK = (k: number, set: any[]) => {
    let se = 0, br = 0, acc = 0;
    for (const x of set) {
      const emA = x.em + k * (x.lostA - x.lostH);
      const pA = 1 / (1 + Math.pow(10, -(emA * p.ppe) / 400));
      se += (x.margin - emA) ** 2; br += (pA - x.win) ** 2; acc += ((pA > 0.5) === (x.win === 1)) ? 1 : 0;
    }
    return { k, n: set.length, margin_rmse: r(Math.sqrt(se / set.length), 3), brier: r(br / set.length), accuracy: r(acc / set.length) };
  };
  const test = withBox.filter((x) => x.season === 2026);
  const injury = { k_fit_2024_25: r(kTrain, 3), k_fit_all: r(kAll, 3), test_2025_26: kGrid.concat([r(kTrain, 3)]).map((k) => evalK(k, test)) };

  // ---- 1) pick backtest vs closing lines, with and without injury adjustment
  const backtest = (k: number) => {
    const t = { ml: { w: 0, l: 0, u: 0 }, spread: { w: 0, l: 0, p: 0, u: 0 }, total: { w: 0, l: 0, p: 0, u: 0 }, games: 0 };
    const w = p.blend_w;
    for (const x of rows) {
      const L = x.line; if (!L || L.spread_home == null || x.season < 2026) continue;
      t.games++;
      const em = x.em + k * (x.lostA - x.lostH);
      const pm = 1 / (1 + Math.pow(10, -(em * p.ppe) / 400));
      const sp = Number(L.spread_home), tl = Number(L.total);
      let gap = Math.abs(em + sp) > p.max_spread_gap;
      if (L.ml_home != null && L.ml_away != null) {
        const ih = implied(Number(L.ml_home)), ia = implied(Number(L.ml_away)); const mh = ih / (ih + ia);
        if (Math.abs(pm - mh) > p.max_ml_gap) gap = true;
        const edge = w * (pm - mh);
        if (!gap && Math.abs(edge) >= p.ml_edge_min) {
          const home = edge > 0; const price = Number(home ? L.ml_home : L.ml_away);
          const won = home ? x.margin > 0 : x.margin < 0;
          if (won) { t.ml.w++; t.ml.u += payout(price); } else { t.ml.l++; t.ml.u -= 1; }
        }
      }
      if (!gap) {
        const bm = w * em + (1 - w) * -sp; const hc = phi((bm + sp) / p.margin_sd);
        const side = hc >= p.ats_min_prob ? 1 : 1 - hc >= p.ats_min_prob ? -1 : 0;
        if (side) { const res = (x.margin + sp) * side; if (res > 0) { t.spread.w++; t.spread.u += 100 / 110; } else if (res < 0) { t.spread.l++; t.spread.u -= 1; } else t.spread.p++; }
      }
      if (tl && Math.abs(x.et - tl) <= p.max_total_gap) {
        const bt = w * x.et + (1 - w) * tl; const ov = 1 - phi((tl - bt) / p.total_sd);
        const side = ov >= p.total_min_prob ? 1 : 1 - ov >= p.total_min_prob ? -1 : 0;
        if (side) { const res = (x.tot - tl) * side; if (res > 0) { t.total.w++; t.total.u += 100 / 110; } else if (res < 0) { t.total.l++; t.total.u -= 1; } else t.total.p++; }
      }
    }
    for (const m of ["ml", "spread", "total"] as const) (t as any)[m].u = r((t as any)[m].u, 2);
    return { k, ...t };
  };
  // raw model vs market: does the model beat the closing line at all? (ATS hit rate when model disagrees by > X)
  const ats: any[] = [];
  for (const thr of [0, 1, 2, 3, 4, 6]) {
    let w = 0, l = 0;
    for (const x of rows) { const L = x.line; if (!L || L.spread_home == null || x.season < 2026) continue;
      const sp = Number(L.spread_home); const g = x.em + sp; if (Math.abs(g) <= thr) continue;
      const res = (x.margin + sp) * Math.sign(g); if (res > 0) w++; else if (res < 0) l++; }
    ats.push({ min_gap_pts: thr, w, l, hit: r(w / Math.max(1, w + l), 3) });
  }
  // closing-line sanity: how good is the market itself
  let mktBr = 0, mktN = 0; for (const x of rows) { const L = x.line; if (!L || L.ml_home == null || x.season < 2026) continue;
    const ih = implied(Number(L.ml_home)), ia = implied(Number(L.ml_away)); const mh = ih / (ih + ia); mktBr += (mh - x.win) ** 2; mktN++; }
  let modBr = 0; for (const x of rows) { const L = x.line; if (!L || L.ml_home == null || x.season < 2026) continue; modBr += (x.p - x.win) ** 2; }

  const result = {
    model: modelId,
    coverage: { games: rows.length, with_box: rows.filter((x) => x.hasBox).length, with_lines_2025_26: rows.filter((x) => x.line && x.season === 2026).length },
    market_vs_model_brier_2025_26: { n: mktN, market: r(mktBr / Math.max(1, mktN)), model: r(modBr / Math.max(1, mktN)) },
    raw_model_ats_by_gap: ats,
    picks_backtest_2025_26: [backtest(0), backtest(r(kTrain, 3))],
    injury,
  };
  await sb.from("analysis_runs").insert({ model_version: modelId, result });
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
});
