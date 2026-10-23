import Link from "next/link";
import type { Game, Injury } from "@/lib/db";
import { MODEL } from "@/lib/db";
import { american, etTime, pct, signed } from "@/lib/format";
import type { Form } from "@/lib/form";

function Res({ r }: { r: string | null }) {
  if (!r) return null;
  return <span className={`res ${r}`}>{r === "win" ? "W" : r === "loss" ? "L" : "P"}</span>;
}

function InjLine({ abbr, list }: { abbr: string; list: Injury[] }) {
  if (!list.length) return null;
  const out = list.filter((i) => i.status === "Out");
  const dtd = list.filter((i) => i.status !== "Out");
  const last = (n: string) => n.split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(w)).slice(-1)[0] ?? n;
  const sorted = (l: Injury[]) => [...l].sort((a, b) => Number(b.key) - Number(a.key) || Number(b.mpg ?? 0) - Number(a.mpg ?? 0));
  const names = (l: Injury[]) => sorted(l).slice(0, 3).map((i) => (i.key ? `${last(i.name)}★` : last(i.name))).join(", ") + (l.length > 3 ? ` +${l.length - 3}` : "");
  return (
    <div className="inj">
      <b>{abbr}</b>
      {out.length > 0 && <> out: {names(out)}</>}
      {dtd.length > 0 && <>{out.length ? " ·" : ""} DTD: {names(dtd)}</>}
    </div>
  );
}

export function Strip({ f }: { f: Form }) {
  if (!f.strip.length) return null;
  const cur = f.strip[f.strip.length - 1].season;
  return (
    <span className="strip" aria-label={`Last ${f.strip.length}: ${f.strip.map((s) => s.r).join("")}`}>
      {f.strip.map((s, i) => (
        <span key={i} className="sw">
          {i > 0 && f.strip[i - 1].season !== s.season && <i className="sep" title="Season boundary">|</i>}
          <b className={`fr ${s.r === "W" ? "w" : "l"} ${s.season !== cur ? "old" : ""}`} title={s.label}>{s.r}</b>
        </span>
      ))}
    </span>
  );
}

function Meta({ f }: { f: Form }) {
  const gp = f.season.w + f.season.l;
  return (
    <span className="meta">
      {gp > 0 ? `${f.season.w}-${f.season.l}` : "0-0"}
      {f.streak ? ` · ${f.streak}` : ""}
      {f.b2b ? <b className="b2b"> · B2B</b> : null}
    </span>
  );
}

export default function GameRow({ g, injuries = [], form }: { g: Game; injuries?: Injury[]; form?: { away: Form; home: Form } }) {
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
          {form && <Meta f={form.away} />}
          <span className="prob">{hp === null ? "—" : pct(1 - hp)}</span>
        </div>
        <div className="probbar" aria-hidden>
          {hp !== null && <i style={{ width: `${(1 - hp) * 100}%` }} />}
        </div>
        <div className={`team ${hp !== null && hp >= 0.5 ? "fav" : ""}`}>
          <img src={g.home.logo} alt="" />
          {g.home.short_name}
          {form && <Meta f={form.home} />}
          <span className="prob">{hp === null ? "—" : pct(hp)}</span>
        </div>
        {form && (
          <div className="forms">
            <div><b>{g.away.abbr}</b> <Strip f={form.away} /></div>
            <div><b>{g.home.abbr}</b> <Strip f={form.home} /></div>
          </div>
        )}
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
        ) : p.flags?.includes("ml-inj") ? <span className="pick pass" title="Withheld: a key player is out or questionable, and the model cannot see absences yet">INJURY HOLD</span> : p.flags?.includes("ml") ? <span className="pick pass" title="Model and market disagree by more than the model can explain">CHECK NEWS</span> : p.market_ml_home != null ? <span className="pick pass">PASS</span> : null)}
      </div>

      <div className="market">
        <div className="label">Spread</div>
        <div className="line">
          {p?.market_spread_home != null ? `${g.home.abbr} ${signed(p.market_spread_home)}` : "No line yet"}
        </div>
        {p && (spPick ? (
          <span className="pick on">{spPick}<small>{pct(p.spread_pick_prob)}</small><Res r={p.spread_result} /></span>
        ) : p.flags?.includes("spread-inj") ? <span className="pick pass" title="Withheld: a key player is out or questionable, and the model cannot see absences yet">INJURY HOLD</span> : p.flags?.includes("spread") ? <span className="pick pass" title="Model and market disagree by more than the model can explain">CHECK NEWS</span> : p.market_spread_home != null ? <span className="pick pass">PASS</span> : null)}
      </div>

      <div className="market">
        <div className="label">Total</div>
        <div className="line">
          {p?.market_total != null ? `O/U ${p.market_total}` : "No line yet"}
        </div>
        {p && (totPick ? (
          <span className="pick on">{totPick}<small>{pct(p.total_pick_prob)}</small><Res r={p.total_result} /></span>
        ) : p.flags?.includes("total-inj") ? <span className="pick pass" title="Withheld: a key player is out or questionable, and the model cannot see absences yet">INJURY HOLD</span> : p.flags?.includes("total") ? <span className="pick pass" title="Model and market disagree by more than the model can explain">CHECK NEWS</span> : p.market_total != null ? <span className="pick pass">PASS</span> : null)}
      </div>
    </Link>
  );
}
