// Stakeman history backfill: for completed games, fetch ESPN game summaries and store
// the closing line (pickcenter) and every player's box score line, incl. did-not-play + reason.
// Call repeatedly: ?limit=120 processes the next N games not yet fetched.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
};

async function summary(id: string) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, { headers: { "user-agent": UA, accept: "application/json" } });
    if (r.ok) return await r.json();
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw new Error("summary fetch failed " + id);
}

async function processGame(g: { id: string; home_team_id: string; away_team_id: string }) {
  const d = await summary(g.id);
  const pc = (d.pickcenter ?? [])[0];
  const line = pc ? {
    game_id: g.id, provider: pc.provider?.name ?? null,
    spread_home: num(pc.spread), total: num(pc.overUnder),
    ml_home: num(pc.homeTeamOdds?.moneyLine), ml_away: num(pc.awayTeamOdds?.moneyLine),
  } : null;
  const players: any[] = [];
  for (const t of d.boxscore?.players ?? []) {
    const teamId = String(t.team?.id ?? "");
    const st = t.statistics?.[0];
    if (!st) continue;
    const names: string[] = st.names ?? st.labels ?? [];
    const iMin = names.indexOf("MIN"), iPts = names.indexOf("PTS"), iPm = names.indexOf("+/-");
    for (const a of st.athletes ?? []) {
      if (!a.athlete?.id) continue;
      const dnp = !!a.didNotPlay || !(a.stats?.length);
      players.push({
        game_id: g.id, team_id: teamId, player_id: String(a.athlete.id), name: a.athlete.displayName ?? "",
        starter: !!a.starter,
        minutes: dnp ? 0 : num(a.stats?.[iMin]), pts: dnp ? 0 : num(a.stats?.[iPts]),
        plus_minus: dnp ? null : num(a.stats?.[iPm]),
        dnp, dnp_reason: dnp ? (a.reason ?? null) : null,
      });
    }
  }
  return { line, players };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 200);
  const minSeason = Number(url.searchParams.get("season") ?? 2024);
  // next completed games without a summary
  const doneSet = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("summary_fetch").select("game_id").eq("ok", true).order("game_id").range(from, from + 999);
    for (const r of data ?? []) doneSet.add(r.game_id);
    if (!data || data.length < 1000) break;
  }
  const todo: any[] = [];
  for (let from = 0; todo.length < limit; from += 1000) {
    const { data, error } = await sb.from("games").select("id,home_team_id,away_team_id")
      .eq("completed", true).neq("season_type", 1).gte("season", minSeason).order("start_time").range(from, from + 999);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    for (const g of data ?? []) if (!doneSet.has(g.id) && todo.length < limit) todo.push(g);
    if (!data || data.length < 1000) break;
  }
  let ok = 0, failed = 0, lines = 0, rows = 0;
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    const res = await Promise.allSettled(batch.map(processGame));
    const lineRows: any[] = [], playerRows: any[] = [], marks: any[] = [];
    res.forEach((r, k) => {
      const id = batch[k].id;
      if (r.status === "fulfilled") {
        if (r.value.line) lineRows.push(r.value.line);
        playerRows.push(...r.value.players);
        marks.push({ game_id: id, ok: true, note: r.value.line ? null : "no line" });
        ok++;
      } else { marks.push({ game_id: id, ok: false, note: String(r.reason).slice(0, 200) }); failed++; }
    });
    if (lineRows.length) { const { error } = await sb.from("game_lines_hist").upsert(lineRows); if (error) throw error; lines += lineRows.length; }
    for (let j = 0; j < playerRows.length; j += 500) {
      const { error } = await sb.from("player_games").upsert(playerRows.slice(j, j + 500)); if (error) throw error;
    }
    rows += playerRows.length;
    await sb.from("summary_fetch").upsert(marks);
  }
  const remaining = Math.max(0, todo.length === limit ? -1 : 0);
  return new Response(JSON.stringify({ processed: todo.length, ok, failed, lines, player_rows: rows, more: remaining !== 0 }), { headers: { "content-type": "application/json" } });
});
