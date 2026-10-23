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
  const bet = (["ml", "spread", "total"] as const).map((k) => ({ k, m: metrics.find((x) => x.scope === "betting" && x.label === k) }));
  const betAll = bet.reduce((a, { m }) => ({ n: a.n + (m?.n ?? 0), u: a.u + Number(m?.units ?? 0), w: a.w + (m?.wins ?? 0), l: a.l + (m?.losses ?? 0) }), { n: 0, u: 0, w: 0, l: 0 });
  const det = bet.find((b) => b.m?.detail)?.m?.detail ?? null;
  const months = det ? Object.entries(det.monthly_units).sort(([a], [b]) => (a < b ? -1 : 1)) : [];
  const maxAbs = Math.max(1, ...months.map(([, v]) => Math.abs(v)));
  const name = { ml: "Moneyline", spread: "Spread", total: "Total" } as const;
  const fmtMonth = (k: string) => new Date(k + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  const research = metrics.find((m) => m.scope === "research" && m.label === "injury")?.detail as any;
  const betVerdict = betAll.n === 0 ? null
    : betAll.u > 0 ? `Profitable in the backtest: ${units(betAll.u)} over ${betAll.n} picks (${(betAll.u / betAll.n * 100).toFixed(1)}% return per pick). Not yet statistically proven: swings month to month are large, so expect losing stretches.`
    : `Not profitable in the backtest: ${units(betAll.u)} over ${betAll.n} picks (${(betAll.u / betAll.n * 100).toFixed(1)}% per pick). Treat picks as information, not a money-maker, until the live record says otherwise.`;

  return (
    <>
      <section className="hero">
        <div className="kicker">Track record · {MODEL}</div>
        <h1>The record</h1>
        <p>Every pick is locked at tip-off and graded automatically against the final score. Nothing is deleted or edited after the fact. Units assume a 1-unit stake at the captured price (−110 for spreads).</p>
      </section>

      {betAll.n > 0 && (
        <section className={`verdict ${betAll.u > 0 ? "has-play" : ""}`}>
          <div className="kicker">Would following the picks have made money?</div>
          <div className="vtitle">{units(betAll.u)}</div>
          <p className="vsub">{betVerdict}</p>
          <div className="vcalls">
            {bet.filter(({ m }) => (m?.n ?? 0) > 0).map(({ k, m }) => (
              <div className="vcall" key={k}>
                <div className="vhead"><span className="vmkt">{name[k]}</span><span className={`vchip ${Number(m?.units ?? 0) > 0 ? "play" : ""}`}>{units(Number(m?.units ?? 0))}</span></div>
                <p>{m?.wins ?? 0}–{m?.losses ?? 0}{m?.pushes ? `–${m.pushes}` : ""} · {m?.accuracy != null ? pct(m.accuracy, 1) : "—"} hit rate · {m?.roi != null ? `${(Number(m.roi) * 100).toFixed(1)}%` : "—"} ROI</p>
              </div>
            ))}
          </div>
          <p className="vnote">Totals were dropped in v1.4: the same test showed totals picks losing 32 units (−9.8% per bet) over 328 picks.</p>
          {det && <p className="vnote">Backtest: today&apos;s pick rules applied to {det.games_with_lines} past games ({det.from ? fmtMonth(det.from.slice(0, 7)) : ""}–{det.to ? fmtMonth(det.to.slice(0, 7)) : ""}) against DraftKings closing lines, 1 unit per pick, −110 on spreads and totals. Each game uses only information from before it. Injury holds aren&apos;t applied (no historical pre-game reports).</p>}
        </section>
      )}

      {research && (
        <section className="chart">
          <h3>Is it skill or luck?</h3>
          <p className="cverdict">A picker with no edge at these prices does this well in about {Math.round(research.luck_share_random_this_good * 100)}% of seasons, roughly 1 in {Math.round(1 / research.luck_share_random_this_good)}.</p>
          <p className="csub" style={{ marginTop: 0 }}>Promising, not proven. The live record below is the real test: every pick is locked before tip-off and graded after the game.</p>
        </section>
      )}

      {research && (
        <section className="chart">
          <h3>What injuries did to the picks</h3>
          <p className="cverdict">Picks on short-handed teams were the most profitable. The market tends to overreact to star absences.</p>
          <div className="edges">
            {[
              { label: "On a team missing a key player", d: research.picks_on_shorthanded_team },
              { label: "No key absence either side", d: research.picks_no_key_absence },
              { label: "Against a team missing a key player", d: research.picks_against_shorthanded_team },
            ].map(({ label, d }) => {
              const max = Math.max(Math.abs(research.picks_on_shorthanded_team.units), Math.abs(research.picks_against_shorthanded_team.units), Math.abs(research.picks_no_key_absence.units));
              return (
                <div className="urow" key={label}>
                  <span className="ulabel">{label}<small>{d.w}–{d.l}</small></span>
                  <div className="utrack">
                    <span className={`ubar ${d.units >= 0 ? "pos" : "neg"}`} style={{ width: `${(Math.abs(d.units) / max) * 50}%`, [d.units >= 0 ? "left" : "right"]: "50%" } as React.CSSProperties} />
                  </div>
                  <span className="uval">{units(d.units)}</span>
                </div>
              );
            })}
          </div>
          <p className="cfoot">Key player = 28+ minutes and 15+ points a game, missing a game after playing in the team&apos;s recent games. Adjusting the model for injuries made its predictions more accurate (Brier {research.brier_base} → {research.brier_injury_adjusted}) but its picks worse ({units(research.adjusting_picks_for_injuries_units)}), because it then agreed with the market. So v1.5 shows the injury-adjusted line for context and keeps picks on the tested rules.</p>
        </section>
      )}

      {months.length > 0 && (
        <section className="chart">
          <h3>Units won or lost by month</h3>
          <p className="cverdict">{months.filter(([, v]) => v > 0).length} of {months.length} months in profit.</p>
          <div className="monthly" role="img" aria-label={months.map(([k, v]) => `${fmtMonth(k)} ${units(v)}`).join(", ")}>
            {months.map(([k, v]) => (
              <div className="mcol2" key={k} title={`${fmtMonth(k)}: ${units(v)}`}>
                <span className="mval">{units(v)}</span>
                <div className="mup">{v > 0 && <span className="mb w" style={{ height: `${(v / maxAbs) * 100}%` }} />}</div>
                <div className="mdown">{v < 0 && <span className="mb l" style={{ height: `${(-v / maxAbs) * 100}%` }} />}</div>
                <span className="mlab2">{fmtMonth(k)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="section">
        <h2>Live picks</h2>
        <div className="statline">
          {(["ml", "spread", "total"] as const).filter((k) => k !== "total" || t.total.w + t.total.l + t.total.pu > 0).map((k) => (
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
