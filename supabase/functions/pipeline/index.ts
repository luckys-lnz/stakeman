// Stakeman pipeline: ingest ESPN NBA scoreboard -> rate teams -> predict -> lock -> grade.
// Actions (query ?action=): sync (default), backfill (&months=202310,202311,...)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = "stakeman-elo-v1.1";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const FIRST_SEASON = 2024; // ESPN season.year (2023-24) = warm-up season

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

type P = {
  k: number; hca: number; carry: number; ppe: number; alpha: number; pcarry: number; hpts: number;
  margin_sd: number; total_sd: number; ml_edge_min: number; ats_min_prob: number; total_min_prob: number;
  blend_w: number; max_ml_gap: number; max_spread_gap: number; max_total_gap: number;
};

// ---------- helpers ----------
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN" || s === "EV") return 100;
  const m = s.replace(/^[OU]/, "").match(/[-+]?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function erf(x: number) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const implied = (american: number) => american < 0 ? -american / (-american + 100) : 100 / (american + 100);
const r4 = (x: number | null) => x === null ? null : Math.round(x * 10000) / 10000;

async function fetchJson(url: string) {
  let last = "";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      },
    });
    if (r.ok) return await r.json();
    last = `${r.status} ${(await r.text()).slice(0, 200)}`;
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error(`fetch failed ${url} :: ${last}`);
}

// ---------- ingest ----------
async function ingest(query: string) {
  const data = await fetchJson(`${ESPN}?dates=${query}&limit=1000`);
  const events = data.events ?? [];
  const teams = new Map<string, any>();
  const games: any[] = [];
  const odds: any[] = [];
  for (const e of events) {
    if (e.season?.type === 1) continue; // skip preseason (incl. international exhibition clubs)
    const c = e.competitions?.[0];
    if (!c) continue;
    const h = c.competitors.find((x: any) => x.homeAway === "home");
    const a = c.competitors.find((x: any) => x.homeAway === "away");
    if (!h || !a) continue;
    for (const t of [h.team, a.team]) {
      teams.set(t.id, { id: t.id, abbr: t.abbreviation, name: t.displayName, short_name: t.shortDisplayName ?? t.name, logo: t.logo, color: t.color, updated_at: new Date().toISOString() });
    }
    const st = e.status?.type ?? {};
    const started = st.state && st.state !== "pre";
    games.push({
      id: e.id, season: e.season.year, season_type: e.season.type, start_time: e.date,
      status: st.name, status_detail: st.shortDetail ?? st.detail, state: st.state, completed: !!st.completed,
      neutral: !!c.neutralSite, home_team_id: h.team.id, away_team_id: a.team.id,
      home_score: started ? num(h.score) : null, away_score: started ? num(a.score) : null,
      venue: c.venue?.fullName ?? null, updated_at: new Date().toISOString(),
    });
    const o = c.odds?.[0];
    if (o && !started) {
      odds.push({
        game_id: e.id, provider: o.provider?.name ?? "unknown",
        spread_home: num(o.pointSpread?.home?.close?.line) ?? num(o.spread),
        spread_home_odds: num(o.pointSpread?.home?.close?.odds), spread_away_odds: num(o.pointSpread?.away?.close?.odds),
        total: num(o.total?.over?.close?.line) ?? num(o.overUnder),
        over_odds: num(o.total?.over?.close?.odds), under_odds: num(o.total?.under?.close?.odds),
        ml_home: num(o.moneyline?.home?.close?.odds), ml_away: num(o.moneyline?.away?.close?.odds),
        open_spread_home: num(o.pointSpread?.home?.open?.line), open_total: num(o.total?.over?.open?.line),
        open_ml_home: num(o.moneyline?.home?.open?.odds), open_ml_away: num(o.moneyline?.away?.open?.odds),
      });
    }
  }
  if (teams.size) {
    const { error } = await sb.from("teams").upsert([...teams.values()]);
    if (error) throw error;
  }
  for (let i = 0; i < games.length; i += 500) {
    const { error } = await sb.from("games").upsert(games.slice(i, i + 500));
    if (error) throw error;
  }
  // insert odds snapshot only if it changed since the last one
  let newOdds = 0;
  for (const o of odds) {
    const { data: last } = await sb.from("odds_snapshots").select("*").eq("game_id", o.game_id).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    const keys = ["spread_home", "total", "ml_home", "ml_away", "spread_home_odds", "spread_away_odds", "over_odds", "under_odds"];
    const changed = !last || keys.some((k) => (last[k] === null ? null : Number(last[k])) !== o[k]);
    if (changed) {
      const { error } = await sb.from("odds_snapshots").insert(o);
      if (error) throw error;
      newOdds++;
    }
  }
  return { query, events: events.length, games: games.length, newOdds };
}

// ---------- model ----------
async function loadAll(table: string, select: string, filter: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(sb.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function model() {
  const { data: mv } = await sb.from("model_versions").select("params").eq("id", MODEL).single();
  const p = mv!.params as P;
  const now = new Date();

  const done = await loadAll("games", "id,season,season_type,start_time,neutral,home_team_id,away_team_id,home_score,away_score",
    (q) => q.eq("completed", true).neq("season_type", 1).gte("season", FIRST_SEASON).order("start_time", { ascending: true }));

  const elo: Record<string, number> = {}, off: Record<string, number> = {}, def: Record<string, number> = {}, gp: Record<string, number> = {};
  let lg = 114, cur: number | null = null;
  const bt: { s: number; p: number; win: number; em: number; margin: number; et: number; tot: number }[] = [];
  const ensure = (t: string) => { if (elo[t] == null) { elo[t] = 1500; off[t] = lg; def[t] = lg; gp[t] = 0; } };
  const newSeason = (s: number) => {
    for (const t in elo) {
      elo[t] = p.carry * elo[t] + (1 - p.carry) * 1505;
      off[t] = lg + p.pcarry * (off[t] - lg); def[t] = lg + p.pcarry * (def[t] - lg); gp[t] = 0;
    }
    cur = s;
  };
  const project = (h: string, a: string, neutral: boolean) => {
    const diff = elo[h] - elo[a] + (neutral ? 0 : p.hca);
    const pr = 1 / (1 + Math.pow(10, -diff / 400));
    const eh = lg + (off[h] - lg) + (def[a] - lg) + (neutral ? 0 : p.hpts / 2);
    const ea = lg + (off[a] - lg) + (def[h] - lg) - (neutral ? 0 : p.hpts / 2);
    return { diff, p: pr, em: diff / p.ppe, eh, ea };
  };

  for (const g of done) {
    if (g.home_score == null || g.away_score == null || g.home_score + g.away_score === 0) continue;
    if (g.season !== cur) newSeason(g.season);
    ensure(g.home_team_id); ensure(g.away_team_id);
    const pr = project(g.home_team_id, g.away_team_id, g.neutral);
    const margin = g.home_score - g.away_score, win = margin > 0 ? 1 : 0;
    if (g.season > FIRST_SEASON) bt.push({ s: g.season, p: pr.p, win, em: pr.em, margin, et: pr.eh + pr.ea, tot: g.home_score + g.away_score });
    const md = win ? pr.diff : -pr.diff;
    const mult = Math.pow(Math.abs(margin) + 3, 0.8) / (7.5 + 0.006 * md);
    const d = p.k * mult * (win - pr.p);
    elo[g.home_team_id] += d; elo[g.away_team_id] -= d;
    const al = p.alpha;
    off[g.home_team_id] = (1 - al) * off[g.home_team_id] + al * g.home_score; def[g.home_team_id] = (1 - al) * def[g.home_team_id] + al * g.away_score;
    off[g.away_team_id] = (1 - al) * off[g.away_team_id] + al * g.away_score; def[g.away_team_id] = (1 - al) * def[g.away_team_id] + al * g.home_score;
    gp[g.home_team_id]++; gp[g.away_team_id]++;
    lg = 0.99 * lg + 0.01 * (g.home_score + g.away_score) / 2;
  }

  // upcoming games (not started, next 4 days)
  const horizon = new Date(now.getTime() + 4 * 86400e3).toISOString();
  const upcoming = await loadAll("games", "id,season,season_type,start_time,neutral,home_team_id,away_team_id,state",
    (q) => q.eq("state", "pre").neq("season_type", 1).gte("start_time", now.toISOString()).lte("start_time", horizon).order("start_time"));
  // a regular season that hasn't started for a team yet still needs the carry-over applied
  const latestSeason = Math.max(cur ?? 0, ...upcoming.map((g: any) => g.season));
  if (cur !== null && latestSeason > cur) newSeason(latestSeason);

  // ratings table
  const asOf = done.length ? done[done.length - 1].start_time : now.toISOString();
  const ratings = Object.keys(elo).map((t) => ({ team_id: t, model_version: MODEL, elo: r4(elo[t]), off_pts: r4(off[t]), def_pts: r4(def[t]), games_played: gp[t], as_of: asOf, updated_at: now.toISOString() }));
  { const { error } = await sb.from("team_ratings").upsert(ratings); if (error) throw error; }

  const { data: lockedRows } = await sb.from("predictions").select("game_id").eq("model_version", MODEL).eq("locked", true).in("game_id", upcoming.map((g: any) => g.id).concat(["-"]));
  const lockedSet = new Set((lockedRows ?? []).map((r: any) => r.game_id));
  let predicted = 0;
  for (const g of upcoming) {
    if (lockedSet.has(g.id)) continue;
    ensure(g.home_team_id); ensure(g.away_team_id);
    const pr = project(g.home_team_id, g.away_team_id, g.neutral);
    const { data: o } = await sb.from("odds_snapshots").select("*").eq("game_id", g.id).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    const row: any = {
      game_id: g.id, model_version: MODEL, updated_at: now.toISOString(), data_snapshot_at: now.toISOString(),
      odds_snapshot_id: o?.id ?? null, home_elo: r4(elo[g.home_team_id]), away_elo: r4(elo[g.away_team_id]),
      home_win_prob: r4(pr.p), exp_home_score: r4(pr.eh), exp_away_score: r4(pr.ea), exp_margin: r4(pr.em), exp_total: r4(pr.eh + pr.ea),
      market_spread_home: null, market_total: null, market_ml_home: null, market_ml_away: null, market_home_prob: null,
      home_cover_prob: null, over_prob: null,
      ml_pick: null, ml_pick_prob: null, ml_edge: null, spread_pick: null, spread_pick_prob: null, spread_line: null,
      total_pick: null, total_pick_prob: null, total_line: null,
    };
    // Picks use a market-blended view: w * model + (1 - w) * market. Gaps too large to trust
    // (usually roster/injury news the model can't see) get no pick and a "check news" flag.
    const w = p.blend_w;
    const flags: string[] = [];
    if (o) {
      // moneyline and spread are the same "who is better" question: a big gap on either suppresses both
      const mlGap = o.ml_home != null && o.ml_away != null
        ? Math.abs(pr.p - (() => { const ih = implied(Number(o.ml_home)), ia = implied(Number(o.ml_away)); return ih / (ih + ia); })()) > p.max_ml_gap
        : false;
      const spGap = o.spread_home != null ? Math.abs(pr.em + Number(o.spread_home)) > p.max_spread_gap : false;
      if (mlGap || spGap) flags.push("ml", "spread");
      if (o.ml_home != null && o.ml_away != null) {
        const ih = implied(Number(o.ml_home)), ia = implied(Number(o.ml_away));
        const mh = ih / (ih + ia);
        row.market_ml_home = o.ml_home; row.market_ml_away = o.ml_away; row.market_home_prob = r4(mh);
        const raw = pr.p - mh;
        const edge = w * raw; // blended prob minus market prob
        if (flags.includes("ml")) { /* check news */ }
        else if (edge >= p.ml_edge_min) { row.ml_pick = "home"; row.ml_pick_prob = r4(mh + edge); row.ml_edge = r4(edge); }
        else if (-edge >= p.ml_edge_min) { row.ml_pick = "away"; row.ml_pick_prob = r4(1 - mh - edge); row.ml_edge = r4(-edge); }
      }
      if (o.spread_home != null) {
        const sp = Number(o.spread_home);
        const bm = w * pr.em + (1 - w) * -sp; // blended expected home margin
        const hc = phi((bm + sp) / p.margin_sd);
        row.market_spread_home = sp; row.home_cover_prob = r4(phi((pr.em + sp) / p.margin_sd)); row.spread_line = sp;
        if (flags.includes("spread")) { /* check news */ }
        else if (hc >= p.ats_min_prob) { row.spread_pick = "home"; row.spread_pick_prob = r4(hc); }
        else if (1 - hc >= p.ats_min_prob) { row.spread_pick = "away"; row.spread_pick_prob = r4(1 - hc); }
      }
      if (o.total != null) {
        const tl = Number(o.total);
        const et = pr.eh + pr.ea;
        const bt2 = w * et + (1 - w) * tl;
        const ov = 1 - phi((tl - bt2) / p.total_sd);
        row.market_total = tl; row.over_prob = r4(1 - phi((tl - et) / p.total_sd)); row.total_line = tl;
        if (Math.abs(et - tl) > p.max_total_gap) flags.push("total");
        else if (ov >= p.total_min_prob) { row.total_pick = "over"; row.total_pick_prob = r4(ov); }
        else if (1 - ov >= p.total_min_prob) { row.total_pick = "under"; row.total_pick_prob = r4(1 - ov); }
      }
    }
    row.flags = flags;
    const { error } = await sb.from("predictions").upsert(row, { onConflict: "game_id,model_version" });
    if (error) throw error;
    predicted++;
  }

  // lock predictions whose game has started
  const { data: toLock } = await sb.from("predictions").select("id,game_id,games!inner(state)").eq("locked", false).neq("games.state", "pre");
  if (toLock?.length) {
    const { error } = await sb.from("predictions").update({ locked: true }).in("id", toLock.map((r: any) => r.id));
    if (error) throw error;
  }

  // grade finished games
  const { data: toGrade } = await sb.from("predictions")
    .select("*,games!inner(completed,home_score,away_score)").is("graded_at", null).eq("games.completed", true);
  let graded = 0;
  for (const pr of toGrade ?? []) {
    const g = pr.games; const margin = g.home_score - g.away_score; const tot = g.home_score + g.away_score;
    const homeWon = margin > 0;
    const res = (x: number) => x > 0 ? "win" : x < 0 ? "loss" : "push";
    const upd: any = { graded_at: now.toISOString(), locked: true, winner_correct: (Number(pr.home_win_prob) > 0.5) === homeWon };
    upd.ml_result = pr.ml_pick ? ((pr.ml_pick === "home") === homeWon ? "win" : "loss") : null;
    upd.spread_result = pr.spread_pick ? res((margin + Number(pr.spread_line)) * (pr.spread_pick === "home" ? 1 : -1)) : null;
    upd.total_result = pr.total_pick ? res((tot - Number(pr.total_line)) * (pr.total_pick === "over" ? 1 : -1)) : null;
    const { error } = await sb.from("predictions").update(upd).eq("id", pr.id);
    if (error) throw error;
    graded++;
  }

  // metrics: backtest (walk-forward) + live (graded, locked predictions)
  const metric = (rows: { p: number; win: number }[]) => {
    const n = rows.length; if (!n) return null;
    const acc = rows.filter((o) => (o.p > 0.5) === (o.win === 1)).length / n;
    const brier = rows.reduce((s, o) => s + (o.p - o.win) ** 2, 0) / n;
    const ll = -rows.reduce((s, o) => s + Math.log(Math.min(Math.max(o.win ? o.p : 1 - o.p, 1e-6), 1)), 0) / n;
    const cal: any[] = [];
    for (let i = 0; i < 9; i++) {
      const lo = 0.5 + i * 0.05, hi = i === 8 ? 1.01 : lo + 0.05;
      const b = rows.filter((o) => { const c = Math.max(o.p, 1 - o.p); return c >= lo && c < hi; });
      if (b.length) cal.push({ bin: `${Math.round(lo * 100)}-${i === 8 ? 100 : Math.round(hi * 100)}`, n: b.length,
        predicted: r4(b.reduce((s, o) => s + Math.max(o.p, 1 - o.p), 0) / b.length),
        actual: r4(b.filter((o) => (o.p > 0.5) === (o.win === 1)).length / b.length) });
    }
    return { n, accuracy: r4(acc), brier: r4(brier), log_loss: r4(ll), calibration: cal };
  };
  const metricsRows: any[] = [];
  const seasons = [...new Set(bt.map((b) => b.s))];
  for (const label of ["all", ...seasons.map(String)]) {
    const rows = label === "all" ? bt : bt.filter((b) => String(b.s) === label);
    const m = metric(rows); if (!m) continue;
    metricsRows.push({ model_version: MODEL, scope: "backtest", label, ...m,
      margin_mae: r4(rows.reduce((s, o) => s + Math.abs(o.margin - o.em), 0) / rows.length),
      total_mae: r4(rows.reduce((s, o) => s + Math.abs(o.tot - o.et), 0) / rows.length), computed_at: now.toISOString() });
  }
  const live = await loadAll("predictions", "home_win_prob,winner_correct,games!inner(home_score,away_score)", (q) => q.eq("model_version", MODEL).not("graded_at", "is", null));
  const lm = metric(live.map((r: any) => ({ p: Number(r.home_win_prob), win: r.games.home_score > r.games.away_score ? 1 : 0 })));
  if (lm) metricsRows.push({ model_version: MODEL, scope: "live", label: "all", ...lm, computed_at: now.toISOString() });
  if (metricsRows.length) { const { error } = await sb.from("model_metrics").upsert(metricsRows, { onConflict: "model_version,scope,label" }); if (error) throw error; }

  return { rated: done.length, upcoming: upcoming.length, predicted, locked: toLock?.length ?? 0, graded, backtest_n: bt.length };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "sync";
  const { data: run } = await sb.from("pipeline_runs").insert({ action }).select("id").single();
  try {
    const detail: any = { ingest: [] };
    if (action === "backfill") {
      const months = (url.searchParams.get("months") ?? "").split(",").filter(Boolean);
      for (const m of months) detail.ingest.push(await ingest(m));
    } else {
      const now = Date.now();
      for (let d = -1; d <= 3; d++) detail.ingest.push(await ingest(ymd(new Date(now + d * 86400e3))));
    }
    if (url.searchParams.get("model") !== "0") detail.model = await model();
    await sb.from("pipeline_runs").update({ finished_at: new Date().toISOString(), ok: true, detail }).eq("id", run!.id);
    return new Response(JSON.stringify(detail), { headers: { "content-type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    await sb.from("pipeline_runs").update({ finished_at: new Date().toISOString(), ok: false, detail: { error: msg } }).eq("id", run!.id);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
