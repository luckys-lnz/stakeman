-- Stakeman schema (applied to Supabase project mzaveoyetbgcfrgzgkvh)
create table public.teams (
  id text primary key, abbr text not null, name text not null, short_name text, logo text, color text,
  updated_at timestamptz not null default now()
);
create table public.games (
  id text primary key, season int not null, season_type int not null, start_time timestamptz not null,
  status text, status_detail text, state text, completed boolean not null default false, neutral boolean not null default false,
  home_team_id text not null references public.teams(id), away_team_id text not null references public.teams(id),
  home_score int, away_score int, venue text, updated_at timestamptz not null default now()
);
create index games_start_idx on public.games (start_time);
create index games_season_idx on public.games (season, season_type);
create table public.odds_snapshots (
  id bigint generated always as identity primary key,
  game_id text not null references public.games(id) on delete cascade,
  provider text not null, captured_at timestamptz not null default now(),
  spread_home numeric, spread_home_odds int, spread_away_odds int, total numeric, over_odds int, under_odds int,
  ml_home int, ml_away int, open_spread_home numeric, open_total numeric, open_ml_home int, open_ml_away int
);
create index odds_game_idx on public.odds_snapshots (game_id, captured_at desc);
create table public.team_ratings (
  team_id text primary key references public.teams(id), model_version text not null,
  elo numeric not null, off_pts numeric not null, def_pts numeric not null, games_played int not null default 0,
  as_of timestamptz not null, updated_at timestamptz not null default now()
);
create table public.model_versions (id text primary key, description text, params jsonb not null, created_at timestamptz not null default now());
create table public.predictions (
  id bigint generated always as identity primary key,
  game_id text not null references public.games(id) on delete cascade,
  model_version text not null references public.model_versions(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  data_snapshot_at timestamptz not null, odds_snapshot_id bigint references public.odds_snapshots(id),
  home_elo numeric, away_elo numeric, home_win_prob numeric not null,
  exp_home_score numeric, exp_away_score numeric, exp_margin numeric, exp_total numeric,
  market_spread_home numeric, market_total numeric, market_ml_home int, market_ml_away int, market_home_prob numeric,
  home_cover_prob numeric, over_prob numeric,
  ml_pick text, ml_pick_prob numeric, ml_edge numeric,
  spread_pick text, spread_pick_prob numeric, spread_line numeric,
  total_pick text, total_pick_prob numeric, total_line numeric,
  flags text[] not null default '{}',
  locked boolean not null default false, graded_at timestamptz, winner_correct boolean,
  ml_result text, spread_result text, total_result text,
  unique (game_id, model_version)
);
create index predictions_game_idx on public.predictions (game_id);
create table public.model_metrics (
  id bigint generated always as identity primary key,
  model_version text not null references public.model_versions(id), scope text not null, label text not null,
  n int not null, accuracy numeric, brier numeric, log_loss numeric, margin_mae numeric, total_mae numeric,
  calibration jsonb, computed_at timestamptz not null default now(),
  unique (model_version, scope, label)
);
create table public.pipeline_runs (
  id bigint generated always as identity primary key, action text not null,
  started_at timestamptz not null default now(), finished_at timestamptz, ok boolean, detail jsonb
);

-- RLS: public read on product tables; writes only via service role (edge function)
alter table public.teams enable row level security;
alter table public.games enable row level security;
alter table public.odds_snapshots enable row level security;
alter table public.team_ratings enable row level security;
alter table public.model_versions enable row level security;
alter table public.predictions enable row level security;
alter table public.model_metrics enable row level security;
alter table public.pipeline_runs enable row level security;
create policy "public read" on public.teams for select to anon, authenticated using (true);
create policy "public read" on public.games for select to anon, authenticated using (true);
create policy "public read" on public.odds_snapshots for select to anon, authenticated using (true);
create policy "public read" on public.team_ratings for select to anon, authenticated using (true);
create policy "public read" on public.model_versions for select to anon, authenticated using (true);
create policy "public read" on public.predictions for select to anon, authenticated using (true);
create policy "public read" on public.model_metrics for select to anon, authenticated using (true);

-- Scheduling
create extension if not exists pg_net;
create extension if not exists pg_cron;
-- select cron.schedule('stakeman-sync', '*/15 * * * *', $$ select net.http_post(url := '<project>/functions/v1/pipeline?action=sync', headers := jsonb_build_object('Authorization','Bearer <anon key>')) $$);
