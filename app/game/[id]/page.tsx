import { notFound } from "next/navigation";
import Link from "next/link";
import { q, oddsFor, injuriesFor, GAME_SELECT, MODEL, type Game, type Injury } from "@/lib/db";
import { american, etDateTime, etLongDay, etTime, pct, signed } from "@/lib/format";

export const revalidate = 60;

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [games, odds] = await Promise.all([q<Game[]>(`games?select=${GAME_SELECT}&id=eq.${id}`), oddsFor([id])]);
  const g = games[0];
  if (!g) notFound();
  const p = g.predictions.find((x) => x.model_version === MODEL);
  const hp = p ? Number(p.home_win_prob) : null;
  const first = odds.length ? odds[odds.length - 1] : null;
  const injuries: Injury[] = g.completed ? [] : await injuriesFor([g.away.id, g.home.id]).catch((): Injury[] => []);

  return (
    <>
      <section className="hero">
        <div className="kicker">
          <Link href="/">← Board</Link> · {etLongDay(g.start_time)} · {etTime(g.start_time)}{g.venue ? ` · ${g.venue}` : ""}
        </div>
        <h1>{g.away.short_name} at {g.home.short_name}</h1>
        {(g.completed || g.state === "in") && (
          <p className="num">{g.completed ? "Final" : g.status_detail}: {g.away.abbr} {g.away_score} – {g.home.abbr} {g.home_score}</p>
        )}
      </section>

      <div className="bigprob">
        <div className="side">
          <img src={g.away.logo} alt="" />
          <span className="p">{hp === null ? "—" : pct(1 - hp)}</span>
          <span className="kicker">{g.away.name}</span>
        </div>
        <div className="vs">@</div>
        <div className="side r">
          <img src={g.home.logo} alt="" />
          <span className="p">{hp === null ? "—" : pct(hp)}</span>
          <span className="kicker">{g.home.name}</span>
        </div>
      </div>


      {!g.completed && (
        <div className="section">
          <h2>Injury report</h2>
          {injuries.length === 0 ? (
            <p className="muted">No players listed for either team.</p>
          ) : (
            <div className="tablewrap" style={{ marginTop: 12 }}>
              <table className="mvm">
                <thead><tr><th>Player</th><th>Team</th><th>Status</th><th>Injury</th><th>Est. return</th></tr></thead>
                <tbody>
                  {[g.away, g.home].flatMap((t) => injuries.filter((i) => i.team_id === t.id).map((i) => (
                    <tr key={i.player_id}>
                      <td>{i.name}{i.position ? <span className="muted"> · {i.position}</span> : null}{i.comment ? <div className="muted" style={{ fontSize: 12, fontFamily: "var(--font-body)", textTransform: "none", marginTop: 2 }}>{i.comment}</div> : null}</td>
                      <td data-l="Team">{t.abbr}</td>
                      <td data-l="Status"><b className={i.status === "Out" ? "res loss" : "res push"} style={{ marginLeft: 0 }}>{i.status}</b></td>
                      <td data-l="Injury">{[i.side, i.injury_type, i.detail].filter((x) => x && x !== "Not Specified").join(" ") || "—"}</td>
                      <td data-l="Est. return" className="num">{i.return_date ?? "—"}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: 13 }}>Source: ESPN injury report. v1 of the model does not adjust for injuries yet; picks on games with key absences deserve extra caution.</p>
        </div>
      )}
      {!p && <div className="callout">No prediction for this game yet. Predictions are made for games within the next four days.</div>}

      {p && (
        <>
          <div className="section">
            <h2>Model vs market</h2>
            <div className="tablewrap" style={{ marginTop: 12 }}>
              <table className="mvm">
                <thead>
                  <tr><th>Market</th><th>Line</th><th>Model view</th><th>Model probability</th><th>Call</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Moneyline</td>
                    <td className="num" data-l="Line">{g.away.abbr} {american(p.market_ml_away)} / {g.home.abbr} {american(p.market_ml_home)}</td>
                    <td className="num" data-l="Model view">Market implies {g.home.abbr} {pct(p.market_home_prob, 1)}</td>
                    <td className="num" data-l="Model probability">{g.home.abbr} {pct(p.home_win_prob, 1)}</td>
                    <td data-l="Call">{p.ml_pick ? <b>{p.ml_pick === "home" ? g.home.abbr : g.away.abbr} ML · {pct(p.ml_edge, 1)} edge</b> : "Pass"}{p.ml_result ? ` · ${p.ml_result.toUpperCase()}` : ""}</td>
                  </tr>
                  <tr>
                    <td>Spread</td>
                    <td className="num" data-l="Line">{g.home.abbr} {signed(p.market_spread_home)}</td>
                    <td className="num" data-l="Model view">{g.home.abbr} {signed(-Number(p.exp_margin))}</td>
                    <td className="num" data-l="Model probability">{g.home.abbr} covers {pct(p.home_cover_prob, 1)}</td>
                    <td data-l="Call">{p.spread_pick ? <b>{p.spread_pick === "home" ? `${g.home.abbr} ${signed(p.spread_line)}` : `${g.away.abbr} ${signed(-Number(p.spread_line))}`}</b> : "Pass"}{p.spread_result ? ` · ${p.spread_result.toUpperCase()}` : ""}</td>
                  </tr>
                  <tr>
                    <td>Total</td>
                    <td className="num" data-l="Line">{p.market_total ?? "—"}</td>
                    <td className="num" data-l="Model view">{Number(p.exp_total).toFixed(1)} ({Number(p.exp_away_score).toFixed(0)}–{Number(p.exp_home_score).toFixed(0)})</td>
                    <td className="num" data-l="Model probability">Over {pct(p.over_prob, 1)}</td>
                    <td data-l="Call">{p.total_pick ? <b>{p.total_pick === "over" ? "Over" : "Under"} {p.total_line}</b> : "Pass"}{p.total_result ? ` · ${p.total_result.toUpperCase()}` : ""}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Prediction {p.locked ? "locked at tip-off" : "updates until tip-off"} · last computed {etDateTime(p.updated_at)} · model {p.model_version} ·
              Elo {g.away.abbr} {Number(p.away_elo).toFixed(0)}, {g.home.abbr} {Number(p.home_elo).toFixed(0)}
            </p>
          </div>

          <div className="section">
            <h2>Line movement</h2>
            {odds.length === 0 ? (
              <p className="muted">No lines captured yet.</p>
            ) : (
              <div className="tablewrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Captured</th><th className="num">{g.home.abbr} spread</th><th className="num">Total</th><th className="num">{g.away.abbr} ML</th><th className="num">{g.home.abbr} ML</th></tr></thead>
                  <tbody>
                    {first?.open_spread_home != null && (
                      <tr className="muted"><td>Open</td><td className="num">{signed(first.open_spread_home)}</td><td className="num">{first.open_total ?? "—"}</td><td className="num">{american(first.open_ml_away)}</td><td className="num">{american(first.open_ml_home)}</td></tr>
                    )}
                    {[...odds].reverse().map((o) => (
                      <tr key={o.id}><td>{etDateTime(o.captured_at)}</td><td className="num">{signed(o.spread_home)}</td><td className="num">{o.total ?? "—"}</td><td className="num">{american(o.ml_away)}</td><td className="num">{american(o.ml_home)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 13 }}>Source: {odds[0]?.provider ?? "DraftKings"} via ESPN.</p>
          </div>
        </>
      )}
    </>
  );
}
