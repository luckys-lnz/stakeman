import Link from "next/link";
import type { Game, Injury } from "@/lib/db";
import { MODEL } from "@/lib/db";
import { american, etTime, pct, signed } from "@/lib/format";

function Res({ r }: { r: string | null }) {
  if (!r) return null;
  return <span className={`res ${r}`}>{r === "win" ? "W" : r === "loss" ? "L" : "P"}</span>;
}

function InjLine({ abbr, list }: { abbr: string; list: Injury[] }) {
  if (!list.length) return null;
  const out = list.filter((i) => i.status === "Out");
  const dtd = list.filter((i) => i.status !== "Out");
  const last = (n: string) => n.split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(w)).slice(-1)[0] ?? n;
  const names = (l: Injury[]) => l.slice(0, 3).map((i) => last(i.name)).join(", ") + (l.length > 3 ? ` +${l.length - 3}` : "");
  return (
    <div className="inj">
      <b>{abbr}</b>
      {out.length > 0 && <> out: {names(out)}</>}
      {dtd.length > 0 && <>{out.length ? " ·" : ""} DTD: {names(dtd)}</>}
    </div>
  );
}

export default function GameRow({ g, injuries = [] }: { g: Game; injuries?: Injury[] }) {
  const p = g.predictions.find((x) => x.model_version === MODEL);
  const hp = p ? Number(p.home_win_prob) : null;
  const live = g.state === "in";
  const fin = g.completed;
  const scoreLine = fin || live ? `${g.away.abbr} ${g.away_score} – ${g.home.abbr} ${g.home_score}` : null;

  const mlPick = p?.ml_pick ? (p.ml_pick === "home" ? g.home.abbr : g.away.abbr) : null;
  const spPick = p?.spread_pick
    ? `${p.spread_pick === "home" ? g.home.abbr : g.away.abbr} ${signed(p.spread_pick === "home" ? p.spread_line : -Number(p.spread_line))}`
    : null;
  const totPick = p?.total_pick ? `${p.total_pick === "over" ? "O" : "U"} ${p.total_line}` : null;

  return (
    <Link href={`/game/${g.id}`} className="game">
      <div className="matchup">
        <div className="time">
          {fin ? <span className="final">FINAL · {scoreLine}</span> : live ? <span className="final">LIVE · {g.status_detail} · {scoreLine}</span> : etTime(g.start_time)}
        </div>
        <div className={`team ${hp !== null && hp < 0.5 ? "fav" : ""}`}>
          <img src={g.away.logo} alt="" />
          {g.away.short_name}
          <span className="prob">{hp === null ? "—" : pct(1 - hp)}</span>
        </div>
        <div className="probbar" aria-hidden>
          {hp !== null && <i style={{ width: `${(1 - hp) * 100}%` }} />}
        </div>
        <div className={`team ${hp !== null && hp >= 0.5 ? "fav" : ""}`}>
          <img src={g.home.logo} alt="" />
          {g.home.short_name}
          <span className="prob">{hp === null ? "—" : pct(hp)}</span>
        </div>
        {injuries.length > 0 && (
          <div className="injs">
            <InjLine abbr={g.away.abbr} list={injuries.filter((i) => i.team_id === g.away.id)} />
            <InjLine abbr={g.home.abbr} list={injuries.filter((i) => i.team_id === g.home.id)} />
          </div>
        )}
      </div>

      <div className="market">
        <div className="label">Moneyline</div>
        <div className="line">
          {p?.market_ml_home != null ? `${g.away.abbr} ${american(p.market_ml_away)} / ${g.home.abbr} ${american(p.market_ml_home)}` : "No line yet"}
        </div>
        {p && (mlPick ? (
          <span className="pick on">{mlPick} ML<small>+{pct(p.ml_edge, 1)} edge</small><Res r={p.ml_result} /></span>
        ) : p.flags?.includes("ml") ? <span className="pick pass" title="Model and market disagree by more than the model can explain">CHECK NEWS</span> : p.market_ml_home != null ? <span className="pick pass">PASS</span> : null)}
      </div>

      <div className="market">
        <div className="label">Spread</div>
        <div className="line">
          {p?.market_spread_home != null ? `${g.home.abbr} ${signed(p.market_spread_home)} · model ${g.home.abbr} ${signed(-Number(p.exp_margin))}` : "No line yet"}
        </div>
        {p && (spPick ? (
          <span className="pick on">{spPick}<small>{pct(p.spread_pick_prob)}</small><Res r={p.spread_result} /></span>
        ) : p.flags?.includes("spread") ? <span className="pick pass" title="Model and market disagree by more than the model can explain">CHECK NEWS</span> : p.market_spread_home != null ? <span className="pick pass">PASS</span> : null)}
      </div>

      <div className="market">
        <div className="label">Total</div>
        <div className="line">
          {p?.market_total != null ? `${p.market_total} · model ${Number(p.exp_total).toFixed(1)}` : "No line yet"}
        </div>
        {p && (totPick ? (
          <span className="pick on">{totPick}<small>{pct(p.total_pick_prob)}</small><Res r={p.total_result} /></span>
        ) : p.flags?.includes("total") ? <span className="pick pass" title="Model and market disagree by more than the model can explain">CHECK NEWS</span> : p.market_total != null ? <span className="pick pass">PASS</span> : null)}
      </div>
    </Link>
  );
}
