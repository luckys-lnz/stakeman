import GameRow from "./GameRow";
import { gamesBetween, injuriesFor, groupInjuries, q, MODEL, type Game, type Injury, type Metric, type Team } from "@/lib/db";
import { recentGames, teamForm, teamMap } from "@/lib/form";
import { calls } from "@/lib/verdict";
import Link from "next/link";
import { etTime } from "@/lib/format";
import { etDay, etLongDay, pct } from "@/lib/format";

export const revalidate = 60;

const TABS = [["all", "All"], ["ml", "Moneyline"], ["spread", "Spread"]] as const;
const MKT: Record<string, string> = { ml: "Moneyline", spread: "Spread", total: "Total" };
const Stars = ({ n }: { n: number }) => <span className="stars" aria-label={`Confidence ${n} of 5`} title={`Confidence ${n} of 5`}>{"★".repeat(n)}<i>{"★".repeat(5 - n)}</i></span>;

export default async function Home({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const tab = m && m in MKT ? m : "all";
  const now = Date.now();
  const [games, metrics, graded] = await Promise.all([
    gamesBetween(new Date(now - 16 * 3600e3).toISOString(), new Date(now + 60 * 3600e3).toISOString()),
    q<Metric[]>(`model_metrics?select=*&model_version=eq.${MODEL}&or=(label.eq.all,scope.eq.betting)`),
    q<{ ml_result: string | null; spread_result: string | null; total_result: string | null }[]>(
      `predictions?select=ml_result,spread_result,total_result&model_version=eq.${MODEL}&graded_at=not.is.null`
    ),
  ]);

  const season = Math.max(...games.map((g) => g.season), 0);
  const [recent, teams] = await Promise.all([
    recentGames(games.flatMap((g) => [g.home.id, g.away.id]), season - 1).catch(() => []),
    q<Team[]>("teams?select=*", 3600).catch((): Team[] => []),
  ]);
  const abbr = teamMap(teams);
  const formFor = (g: Game) => ({
    away: teamForm(g.away.id, recent, g.start_time, g.season, abbr),
    home: teamForm(g.home.id, recent, g.start_time, g.season, abbr),
  });
  const inj = groupInjuries(await injuriesFor(games.flatMap((g) => [g.home.id, g.away.id])).catch((): Injury[] => []));
  const pending = games.filter((g) => g.state === "pre");
  const upcomingCount = pending.length;
  const plays = pending.flatMap((g) => {
    const p = g.predictions.find((x) => x.model_version === MODEL);
    const injs = [...(inj.get(g.away.id) ?? []), ...(inj.get(g.home.id) ?? [])];
    return calls(g, p, injs).filter((c) => c.status === "play").map((c) => ({ g, c }));
  }).filter(({ c }) => tab === "all" || c.market === MKT[tab]).sort((a, b) => (b.c.stars ?? 0) - (a.c.stars ?? 0)).slice(0, 20);
  const today = etDay(new Date(now).toISOString());
  const byDay = new Map<string, Game[]>();
  for (const g of games) {
    const d = etDay(g.start_time);
    if (d < today && !g.completed && g.state !== "in") continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(g);
  }
  // keep yesterday only if it has games still live
  const days = [...byDay.entries()].filter(([d, gs]) => d >= today || gs.some((g) => g.state === "in")).slice(0, 3);

  const bt = metrics.find((m) => m.scope === "backtest" && m.label === "all");
  const betRows = metrics.filter((m) => m.scope === "betting");
  const betN = betRows.reduce((a, m) => a + (m.n ?? 0), 0), betU = betRows.reduce((a, m) => a + Number(m.units ?? 0), 0);
  const all = graded.flatMap((r) => [r.ml_result, r.spread_result, r.total_result]).filter(Boolean) as string[];
  const w = all.filter((r) => r === "win").length, l = all.filter((r) => r === "loss").length;

  return (
    <>
      <section className="hero">
        <div className="kicker">NBA · 2026–27 regular season</div>
        <h1>Tonight&apos;s board</h1>
        <p>Plays first: the bets where the model disagrees with the market by enough to matter. Every other game is a pass. Tap any game for the charts behind the call.</p>
      </section>

      <div className="statline">
        <div className="stat"><b className="num">{betN ? `${betU > 0 ? "+" : ""}${betU.toFixed(1)}u` : "—"}</b><span>Backtest profit · {betN} picks</span></div>
        <div className="stat"><b className="num">{betN ? `${(betU / betN * 100).toFixed(1)}%` : "—"}</b><span>Return per pick</span></div>
        <div className="stat"><b className="num">{bt ? pct(bt.accuracy, 1) : "—"}</b><span>Winners called · {bt?.n.toLocaleString() ?? 0} games</span></div>
        <div className="stat"><b className="num">{w}–{l}</b><span>Live pick record</span></div>
      </div>

      <section className="plays">
        <div className="dayhead">
          <h2>Plays</h2>
          <nav className="tabs" aria-label="Market">
            {TABS.map(([k, label]) => <Link key={k} href={k === "all" ? "/" : `/?m=${k}`} className={tab === k ? "on" : ""} scroll={false}>{label}</Link>)}
          </nav>
        </div>
        {plays.length === 0 ? (
          <p className="muted">No {tab === "all" ? "" : MKT[tab].toLowerCase() + " "}plays right now. The model agrees with the market on the games left to tip.</p>
        ) : plays.map(({ g, c }) => (
          <Link key={g.id + c.market} href={`/game/${g.id}`} className="playrow">
            <span className="ptime">{etTime(g.start_time)}</span>
            <span className="pgame">{g.away.abbr} @ {g.home.abbr}<small>{c.market}</small></span>
            <span className="ppick">{c.pick}<small> {c.market === "Moneyline" ? c.price : `${c.price} to hit`}</small></span>
            <span className="pconf">{c.stars ? <Stars n={c.stars} /> : null}</span>
            <span className="ppay">{c.win100 != null ? <>$100 wins <b>${c.win100.toFixed(0)}</b></> : null}</span>
            <span className="preason">{c.reason}</span>
          </Link>
        ))}
        <p className="muted pnote">Ranked by confidence (★ = size of the edge). Payouts at the listed price; spreads assume −110. <Link href="/record">See the record</Link>.</p>
      </section>

      {days.length === 0 && <div className="empty">No games on the board in the next two days.</div>}
      {days.map(([d, gs]) => (
        <section key={d}>
          <div className="dayhead">
            <h2>{d === today ? "Today" : etLongDay(gs[0].start_time).split(",")[0]}</h2>
            <span className="kicker">{etLongDay(gs[0].start_time)} · {gs.length} games</span>
          </div>
          {gs.map((g) => <GameRow key={g.id} g={g} form={formFor(g)} injuries={[...(inj.get(g.away.id) ?? []), ...(inj.get(g.home.id) ?? [])]} />)}
        </section>
      ))}
    </>
  );
}
