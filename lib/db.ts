// Read-only access to Stakeman's public tables via Supabase REST (RLS allows public select only).
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://mzaveoyetbgcfrgzgkvh.supabase.co";
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YXZlb3lldGJnY2ZyZ3pna3ZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NTg0MzgsImV4cCI6MjEwODMzNDQzOH0.ntpBKplR8-IzKPlP5fLk6IWktRtiGZGk9u2wQXXmZfM";

export const MODEL = "stakeman-elo-v1.3";

export async function q<T = any>(path: string, revalidate = 60): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    next: { revalidate },
  });
  if (!r.ok) throw new Error(`db ${r.status}: ${await r.text()}`);
  return r.json();
}

export type Team = { id: string; abbr: string; name: string; short_name: string; logo: string; color: string };
export type Prediction = {
  id: number; game_id: string; model_version: string; created_at: string; updated_at: string; data_snapshot_at: string;
  home_elo: number; away_elo: number; home_win_prob: number;
  exp_home_score: number; exp_away_score: number; exp_margin: number; exp_total: number;
  market_spread_home: number | null; market_total: number | null; market_ml_home: number | null; market_ml_away: number | null;
  market_home_prob: number | null; home_cover_prob: number | null; over_prob: number | null;
  ml_pick: "home" | "away" | null; ml_pick_prob: number | null; ml_edge: number | null;
  spread_pick: "home" | "away" | null; spread_pick_prob: number | null; spread_line: number | null;
  total_pick: "over" | "under" | null; total_pick_prob: number | null; total_line: number | null;
  flags: string[]; locked: boolean; graded_at: string | null; winner_correct: boolean | null;
  ml_result: string | null; spread_result: string | null; total_result: string | null;
};
export type Game = {
  id: string; season: number; season_type: number; start_time: string; status: string; status_detail: string; state: string;
  completed: boolean; neutral: boolean; home_score: number | null; away_score: number | null; venue: string | null;
  home: Team; away: Team; predictions: Prediction[];
};
export type Odds = {
  id: number; game_id: string; provider: string; captured_at: string;
  spread_home: number | null; total: number | null; ml_home: number | null; ml_away: number | null;
  spread_home_odds: number | null; spread_away_odds: number | null; over_odds: number | null; under_odds: number | null;
  open_spread_home: number | null; open_total: number | null; open_ml_home: number | null; open_ml_away: number | null;
};
export type Metric = {
  scope: string; label: string; n: number; accuracy: number; brier: number; log_loss: number;
  margin_mae: number | null; total_mae: number | null;
  calibration: { bin: string; n: number; predicted: number; actual: number }[];
};

export const GAME_SELECT =
  "*,home:teams!games_home_team_id_fkey(*),away:teams!games_away_team_id_fkey(*),predictions(*)";

export async function gamesBetween(fromISO: string, toISO: string) {
  return q<Game[]>(
    `games?select=${GAME_SELECT}&season_type=neq.1&start_time=gte.${encodeURIComponent(fromISO)}&start_time=lte.${encodeURIComponent(toISO)}&order=start_time.asc`
  );
}

export async function oddsFor(ids: string[]) {
  if (!ids.length) return [] as Odds[];
  return q<Odds[]>(`odds_snapshots?select=*&game_id=in.(${ids.join(",")})&order=captured_at.desc`);
}

export type Injury = {
  player_id: string; team_id: string; name: string; position: string | null; status: string;
  fantasy_status: string | null; injury_type: string | null; detail: string | null; location: string | null;
  side: string | null; return_date: string | null; comment: string | null; reported_at: string | null; captured_at: string;
  mpg: number | null; ppg: number | null; key: boolean;
};

export async function injuriesFor(teamIds: string[]) {
  if (!teamIds.length) return [] as Injury[];
  return q<Injury[]>(`injuries_current?select=*&team_id=in.(${[...new Set(teamIds)].join(",")})&order=status.desc,name.asc`);
}

export function groupInjuries(list: Injury[]) {
  const m = new Map<string, Injury[]>();
  for (const i of list) {
    if (!m.has(i.team_id)) m.set(i.team_id, []);
    m.get(i.team_id)!.push(i);
  }
  return m;
}
