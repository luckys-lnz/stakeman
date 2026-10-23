import Link from "next/link";
import { q, MODEL, type Game, type Metric, type Prediction } from "@/lib/db";
import { etDateTime, payout, pct, signed } from "@/lib/format";

export const revalidate = 300;

type Row = Prediction & { games: Game };

const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;

function tally(rows: Row[], key: "ml" | "spread" | "total") {
  let w = 0, l = 0, pu = 0, units = 0;
  for (const r of rows) {
    const res = r[`${key}_result` as const];
    if (!res) continue;
    let price = -110;
    if (key === "ml") price = Number(r.ml_pick === "home" ? r.market_ml_home : r.market_ml_away);
    if (res === "win") { w++; units += payout(price); }
    else if (res === "loss") { l++; units -= 1; }
    else pu++;
  }
  return { w, l, pu, units };
}

export default async function Record() {
  const [metrics, rows] = await Promise.all([
    q<Metric[]>(`model_metrics?select=*&model_version=eq.${MODEL}&order=label.asc`),
    q<Row[]>(`predictions?select=*,games!inner(*,home:teams!games_home_team_id_fkey(*),away:teams!games_away_team_id_fkey(*))&model_version=eq.${MODEL}&graded_at=not.is.null&order=graded_at.desc&limit=500`),
  ]);
  const bt = metrics.find((m) => m.scope === "backtest" && m.label === "all");
  const seasons = metrics.filter((m) => m.scope === "backtest" && m.label !== "all");
  const live = metrics.find((m) => m.scope === "live");
  const t = { ml: tally(rows, "ml"), spread: tally(rows, "spread"), total: tally(rows, "total") };

  return (
    <>
      <section className="hero">
        <div className="kicker">Track record · {MODEL}</div>
        <h1>The record</h1>
        <p>Every pick is locked at tip-off and graded automatically against the final score. Nothing is deleted or edited after the fact. Units assume a 1-unit stake at the captured price (−110 for spreads and totals).</p>
      </section>

      <div className="section">
        <h2>Live picks</h2>
        <div className="statline">
          {(["ml", "spread", "total"] as const).map((k) => (
            <div className="stat" key={k}>
              <b className="num">{t[k].w}–{t[k].l}{t[k].pu ? `–${t[k].pu}` : ""}</b>
              <span>{k === "ml" ? "Moneyline" : k === "spread" ? "Spread" : "Total"} · {units(t[k].units)}</span>
            </div>
          ))}
          <div className="stat"><b className="num">{live ? pct(live.accuracy, 1) : "—"}</b><span>Winners called · {live?.n ?? 0} games</span></div>
        </div>
        {rows.length === 0 ? (
          <p className="muted">The live record starts with the first games graded tonight.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Game</th><th>Final</th><th>Moneyline</th><th>Spread</th><th>Total</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const g = r.games;
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/game/${g.id}`}>{g.away.abbr} @ {g.home.abbr}</Link><div className="muted" style={{ fontSize: 12 }}>{etDateTime(g.start_time)}</div></td>
                      <td className="num">{g.away_score}–{g.home_score}</td>
                      <td className="num">{r.ml_pick ? `${r.ml_pick === "home" ? g.home.abbr : g.away.abbr} · ${r.ml_result?.toUpperCase()}` : <span className="muted">pass</span>}</td>
                      <td className="num">{r.spread_pick ? `${r.spread_pick === "home" ? g.home.abbr + " " + signed(r.spread_line) : g.away.abbr + " " + signed(-Number(r.spread_line))} · ${r.spread_result?.toUpperCase()}` : <span className="muted">pass</span>}</td>
                      <td className="num">{r.total_pick ? `${r.total_pick === "over" ? "O" : "U"} ${r.total_line} · ${r.total_result?.toUpperCase()}` : <span className="muted">pass</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section grid2">
        <div>
          <h2>Backtest</h2>
          <p className="muted">Walk-forward over past seasons: each game is predicted using only games played before it.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Season</th><th className="num">Games</th><th className="num">Winners</th><th className="num">Brier</th><th className="num">Log loss</th></tr></thead>
              <tbody>
                {seasons.map((m) => (
                  <tr key={m.label}><td>{Number(m.label) - 1}–{String(m.label).slice(2)}</td><td className="num">{m.n}</td><td className="num">{pct(m.accuracy, 1)}</td><td className="num">{Number(m.brier).toFixed(3)}</td><td className="num">{Number(m.log_loss).toFixed(3)}</td></tr>
                ))}
                {bt && <tr><td><b>All</b></td><td className="num"><b>{bt.n}</b></td><td className="num"><b>{pct(bt.accuracy, 1)}</b></td><td className="num"><b>{Number(bt.brier).toFixed(3)}</b></td><td className="num"><b>{Number(bt.log_loss).toFixed(3)}</b></td></tr>}
              </tbody>
            </table>
          </div>
          {bt && <p className="muted" style={{ fontSize: 13 }}>Average miss: {Number(bt.margin_mae).toFixed(1)} pts on margin, {Number(bt.total_mae).toFixed(1)} pts on total. A coin flip scores 0.250 Brier.</p>}
        </div>
        <div>
          <h2>Calibration</h2>
          <p className="muted">When the model says 70%, the favorite should win about 70% of the time. Black bar = actual win rate, tick = predicted.</p>
          <div className="cal">
            {(bt?.calibration ?? []).map((c) => (
              <div className="row" key={c.bin}>
                <span className="num">{c.bin}%</span>
                <div className="track">
                  <div className="act" style={{ width: `${c.actual * 100}%` }} />
                  <div className="pred" style={{ left: `${c.predicted * 100}%` }} />
                </div>
                <span className="num muted">{pct(c.actual, 1)} · n={c.n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
