import GameRow from "./GameRow";
import { gamesBetween, q, MODEL, type Game, type Metric } from "@/lib/db";
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
        <p>Win probabilities from the Stakeman model for every game, next to the market line. A highlighted pick means the model disagrees with the market by enough to matter. Everything else is a pass.</p>
      </section>

      <div className="statline">
        <div className="stat"><b className="num">{bt ? pct(bt.accuracy, 1) : "—"}</b><span>Backtest winners · {bt?.n.toLocaleString() ?? 0} games</span></div>
        <div className="stat"><b className="num">{bt ? Number(bt.brier).toFixed(3) : "—"}</b><span>Brier score</span></div>
        <div className="stat"><b className="num">{w}–{l}</b><span>Live pick record</span></div>
      </div>

      {days.length === 0 && <div className="empty">No games on the board in the next two days.</div>}
      {days.map(([d, gs]) => (
        <section key={d}>
          <div className="dayhead">
            <h2>{d === today ? "Today" : etLongDay(gs[0].start_time).split(",")[0]}</h2>
            <span className="kicker">{etLongDay(gs[0].start_time)} · {gs.length} games</span>
          </div>
          {gs.map((g) => <GameRow key={g.id} g={g} />)}
        </section>
      ))}
    </>
  );
}
