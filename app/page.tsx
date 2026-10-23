import GameRow from "./GameRow";
import { gamesBetween, injuriesFor, groupInjuries, q, MODEL, type Game, type Injury, type Metric, type Team } from "@/lib/db";
import { recentGames, teamForm, teamMap } from "@/lib/form";
import { calls } from "@/lib/verdict";
import Link from "next/link";
import { etTime } from "@/lib/format";
import { etDay, etLongDay, pct } from "@/lib/format";

export const revalidate = 60;

export default async function Home() {
  const now = Date.now();
  const [games, metrics, graded] = await Promise.all([
    gamesBetween(new Date(now - 16 * 3600e3).toISOString(), new Date(now + 60 * 3600e3).toISOString()),
    q<Metric[]>(`model_metrics?select=*&model_version=eq.${MODEL}&label=eq.all`),
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
  }).slice(0, 20);
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

  const bt = metrics.find((m) => m.scope === "backtest");
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
        <div className="stat"><b className="num">{bt ? pct(bt.accuracy, 1) : "—"}</b><span>Backtest winners · {bt?.n.toLocaleString() ?? 0} games</span></div>
        <div className="stat"><b className="num">{bt ? Number(bt.brier).toFixed(3) : "—"}</b><span>Brier score</span></div>
        <div className="stat"><b className="num">{w}–{l}</b><span>Live pick record</span></div>
      </div>

      {plays.length > 0 && (
        <section className="plays">
          <div className="dayhead"><h2>Plays</h2><span className="kicker">{plays.length} pick{plays.length > 1 ? "s" : ""} · {upcomingCount} games still to tip</span></div>
          {plays.map(({ g, c }) => (
            <Link key={g.id + c.market} href={`/game/${g.id}`} className="playrow">
              <span className="ptime">{etTime(g.start_time)}</span>
              <span className="pgame">{g.away.abbr} @ {g.home.abbr}</span>
              <span className="pmkt">{c.market}</span>
              <span className="ppick">{c.pick}{c.price ? <small> {c.price}</small> : null}</span>
              <span className="preason">{c.reason}</span>
            </Link>
          ))}
        </section>
      )}

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
