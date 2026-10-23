# Stakeman

Model-driven NBA probabilities for moneyline, spread and total — every prediction time-stamped, locked at tip-off and graded in public.

## How it works

```
ESPN scoreboard (free, no key)          every 15 min (pg_cron → pg_net)
  schedule · scores · DraftKings lines ───────────────► Edge Function `pipeline`
                                                          1. ingest games + odds snapshots
                                                          2. rate teams (Elo + EWMA points)
                                                          3. predict next 4 days, blend with market
                                                          4. lock at tip-off, grade finals
                                                          5. backtest + live metrics
                                                                   │
                                     Supabase Postgres (RLS: public read) ◄┘
                                                                   │
                                           Next.js site (this repo, Vercel)
```

- **Model:** `stakeman-elo-v1.3` — Elo (K=20, home court 50 Elo ≈ 1.8 pts, 40% regression between seasons, MOV multiplier) + EWMA points model for totals. Picks use a 40/60 model/market blend; big model–market gaps are flagged "check news" instead of picked. Injury guard: a key player (28+ min & 15+ pts/g) newly Out or Day-To-Day (reported ≤21 days ago) withholds picks on that team and overs in that game.
- **Backtest (walk-forward, 2024-25 + 2025-26, 2,666 games):** 67.1% winners, Brier 0.209, log loss 0.606, calibrated within ~2 pts per bin.
- **Params** live in `model_versions.params`; new params = new version row, so the record per version stays honest.

## Layout

- `app/` — Next.js App Router pages: board (`/`), game detail (`/game/[id]`), record (`/record`), method (`/method`)
- `lib/` — read-only Supabase REST client + formatting
- `supabase/functions/pipeline/` — the data + model pipeline (Deno)
- `supabase/migrations/` — schema

## Run locally

```
npm install
npm run dev
```

Env (optional — defaults point at the production project's public anon key):

```
NEXT_PUBLIC_SUPABASE_URL=https://mzaveoyetbgcfrgzgkvh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Roadmap

1. Point value per absence (player on/off impact) → injury-adjusted ratings instead of holds
2. Multi-book lines + line movement (The Odds API free tier)
3. Rest / back-to-back / travel features
4. Accounts + paid tier once the live record supports it
