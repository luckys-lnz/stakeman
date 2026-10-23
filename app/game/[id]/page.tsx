import { notFound } from "next/navigation";
import Link from "next/link";
import { q, oddsFor, injuriesFor, GAME_SELECT, MODEL, type Game, type Injury, type Team } from "@/lib/db";
import { recentGames, teamForm, headToHead, teamMap, type Form } from "@/lib/form";
import { calls, headline, edges } from "@/lib/verdict";
import { Strip } from "../../GameRow";
import { ProbSplit, NumberLine, MarginBars, EdgeRows } from "../../charts";
import { american, etDateTime, etLongDay, etTime, pct, signed } from "@/lib/format";

export const revalidate = 60;

const lastName = (n: string) => n.split(" ").filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(w)).slice(-1)[0] ?? n;
const sg = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${Number(x.toFixed(1))}`);

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [games, odds] = await Promise.all([q<Game[]>(`games?select=${GAME_SELECT}&id=eq.${id}`), oddsFor([id])]);
  const g = games[0];
  if (!g) notFound();
  const p = g.predictions.find((x) => x.model_version === MODEL);
  const first = odds.length ? odds[odds.length - 1] : null;
  const injuries: Injury[] = g.completed ? [] : await injuriesFor([g.away.id, g.home.id]).catch((): Injury[] => []);
  const [recent, teams, ratings] = await Promise.all([
    recentGames([g.away.id, g.home.id], g.season - 2).catch(() => []),
    q<Team[]>("teams?select=*", 3600).catch((): Team[] => []),
    q<{ team_id: string; elo: number }[]>("team_ratings?select=team_id,elo&order=elo.desc", 300).catch((): { team_id: string; elo: number }[] => []),
  ]);
  const abbr = teamMap(teams);
  const fa = teamForm(g.away.id, recent, g.start_time, g.season, abbr);
  const fh = teamForm(g.home.id, recent, g.start_time, g.season, abbr);
  const h2h = headToHead(g.away.id, g.home.id, recent, g.start_time, 5);
  const nba = ratings.filter((r) => /^([1-9]|[12][0-9]|30)$/.test(r.team_id)); // the 30 franchises (excludes All-Star squads)
  const rank = (tid: string) => { const i = nba.findIndex((r) => r.team_id === tid); return i >= 0 ? i + 1 : null; };
  const A = g.away.abbr, H = g.home.abbr;

  const cs = calls(g, p, injuries);
  const hl = headline(cs);
  const edgeRows = edges(fa, fh, rank(g.away.id), rank(g.home.id));
  const edgeA = edgeRows.filter((r) => r.edge === "a").length, edgeH = edgeRows.filter((r) => r.edge === "h").length;
  const keyOut = injuries.filter((i) => i.key);
  // injury-adjusted view (information only): 0.078 pts of margin per point-per-game a fresh absence takes away
  const K_INJ = 0.0783, fresh = Date.now() - 21 * 86400e3;
  const outFresh = injuries.filter((i) => i.status === "Out" && Number(i.mpg ?? 0) >= 15 && i.reported_at && new Date(i.reported_at).getTime() >= fresh);
  const lostPts = (tid: string) => outFresh.filter((i) => i.team_id === tid).reduce((s, i) => s + Number(i.ppg ?? 0), 0);
  const injAdj = K_INJ * (lostPts(g.away.id) - lostPts(g.home.id)); // + helps home
  const gpA = fa.season.w + fa.season.l, gpH = fh.season.w + fh.season.l;

  // chart verdicts — one line each
  const hp = p ? Number(p.home_win_prob) : null, mh = p?.market_home_prob != null ? Number(p.market_home_prob) : null;
  const winVerdict = hp == null ? null : mh == null
    ? `Model: ${hp >= 0.5 ? H : A} ${pct(Math.max(hp, 1 - hp))} to win.`
    : Math.abs(hp - mh) < 0.03 ? `Model and market agree: ${hp >= 0.5 ? H : A} is about ${pct(Math.max(hp, 1 - hp))} to win.`
    : `Model is higher on ${hp > mh ? H : A} than the market (${pct(hp > mh ? hp : 1 - hp)} vs ${pct(hp > mh ? mh : 1 - mh)}).`;
  const ms = p?.market_spread_home != null ? Number(p.market_spread_home) : null, mod = p ? -Number(p.exp_margin) : null;
  const modInj = mod != null ? mod - injAdj : null; // home spread view after injuries
  const injNote = mod != null && Math.abs(injAdj) >= 0.5
    ? `Counting fresh absences (${outFresh.map((i) => i.name.split(" ").slice(-1)[0]).join(", ")}), the model's line moves ${Math.abs(injAdj).toFixed(1)} pts toward ${injAdj > 0 ? H : A}: ${H} ${(modInj! > 0 ? "+" : "") + modInj!.toFixed(1)}. Shown for context; picks use the tested rules.`
    : null;
  const spreadVerdict = ms == null || mod == null ? null
    : Math.abs(mod - ms) < 1.5 ? `Model and line within ${Math.abs(mod - ms).toFixed(1)} pts: no edge.`
    : `Model rates ${mod < ms ? H : A} ${Math.abs(mod - ms).toFixed(1)} pts better than the line does.`;
  const tl = p?.market_total != null ? Number(p.market_total) : null, et = p ? Number(p.exp_total) : null;
  const totalVerdict = tl == null || et == null ? null
    : Math.abs(et - tl) < 3 ? `Projection ${et.toFixed(1)} is close to the line (${tl}): no edge.`
    : `Model projects ${Math.abs(et - tl).toFixed(1)} pts ${et > tl ? "more" : "fewer"} than the line (a lean, not a pick: totals picks lost money in testing).`;
  const formVerdict = fa.l10 && fh.l10
    ? Math.abs(fa.l10.margin - fh.l10.margin) < 2 ? `Similar recent form (avg margin ${sg(fa.l10.margin)} vs ${sg(fh.l10.margin)}).`
      : `${fa.l10.margin > fh.l10.margin ? A : H} in better form: avg margin ${sg(Math.max(fa.l10.margin, fh.l10.margin))} vs ${sg(Math.min(fa.l10.margin, fh.l10.margin))} over the last 10.`
    : null;
  const atsVerdict = fa.ats.n >= 5 && fh.ats.n >= 5
    ? `Against the spread: ${A} ${fa.ats.w}-${fa.ats.l}, ${H} ${fh.ats.w}-${fh.ats.l} in their last ${Math.min(fa.ats.n, fh.ats.n)}+ games with a line.`
    : null;
  const edgeVerdict = edgeRows.length ? (edgeA === edgeH ? `Even on the numbers (${edgeA}–${edgeH}).` : `${edgeA > edgeH ? A : H} has the edge on ${Math.max(edgeA, edgeH)} of ${edgeRows.length}.`) : null;

  // total chart range
  const tVals = [tl, et, fa.l10?.total, fh.l10?.total].filter((v): v is number => v != null);
  const tMid = tl ?? et ?? 225;
  const tSpan = Math.max(15, ...tVals.map((v) => Math.abs(v - tMid) + 4));
  const sVals = [ms, mod].filter((v): v is number => v != null);
  const sSpan = Math.max(10, ...sVals.map((v) => Math.abs(v) + 3));

  return (
    <>
      <section className="hero">
        <div className="kicker">
          <Link href="/">← Board</Link> · {etLongDay(g.start_time)} · {etTime(g.start_time)}{g.venue ? ` · ${g.venue}` : ""}
        </div>
        <h1>{g.away.short_name} at {g.home.short_name}</h1>
        {(g.completed || g.state === "in") && (
          <p className="num">{g.completed ? "Final" : g.status_detail}: {A} {g.away_score} – {H} {g.home_score}</p>
        )}
      </section>

      {/* 1 — the verdict */}
      <section className={`verdict ${cs.some((c) => c.status === "play") ? "has-play" : ""}`}>
        <div className="kicker">Stakeman verdict</div>
        <div className="vtitle">{hl.title}</div>
        <p className="vsub">{hl.sub}</p>
        <div className="vcalls">
          {cs.map((c) => (
            <div key={c.market} className={`vcall ${c.status}`}>
              <div className="vhead">
                <span className="vmkt">{c.market}</span>
                <span className={`vchip ${c.status}`}>
                  {c.status === "play" ? `${c.pick}${c.price ? ` · ${c.price}` : ""}` : c.status === "hold" ? "Injury hold" : c.status === "news" ? "Check news" : c.status === "noline" ? "No line" : "Pass"}
                </span>
              </div>
              <p>{c.reason}</p>
            </div>
          ))}
        </div>
        {(gpA < 5 || gpH < 5) && <p className="vnote">Early season: {A} has played {gpA} game{gpA === 1 ? "" : "s"}, {H} {gpH}. Ratings still lean on last season.</p>}
        {keyOut.length > 0 && <p className="vnote">Key absences: {keyOut.map((i) => `${lastName(i.name)} (${abbr(i.team_id)}, ${i.status === "Out" ? "out" : "questionable"})`).join(", ")}.</p>}
      </section>

      {/* 2 — the evidence, one question per chart */}
      {p && hp != null && (
        <section className="chart">
          <h3>Who wins?</h3>
          <p className="cverdict">{winVerdict}</p>
          <ProbSplit away={A} home={H} rows={[{ label: "Model", home: hp }, ...(mh != null ? [{ label: "Market", home: mh }] : [])]} />
        </section>
      )}

      {ms != null && mod != null && (
        <section className="chart">
          <h3>Spread: by how much?</h3>
          <p className="cverdict">{spreadVerdict}</p>
          <NumberLine min={-sSpan} max={sSpan} left={`${H} favored ←`} right={`→ ${A} favored`}
            marks={[{ v: ms, label: `Line ${H}`, kind: "market" }, { v: mod, label: `Model ${H}`, kind: "model" },
              ...(injNote && modInj != null ? [{ v: modInj, label: "Model with injuries", kind: "ref" as const }] : [])]} />
          {injNote && <p className="cfoot">{injNote}</p>}
        </section>
      )}

      {tl != null && et != null && (
        <section className="chart">
          <h3>Total: how many points? <small className="muted" style={{ fontFamily: "var(--font-body)", textTransform: "none", fontSize: 13, fontWeight: 500 }}>· info only, no totals picks</small></h3>
          <p className="cverdict">{totalVerdict}</p>
          <NumberLine min={tMid - tSpan} max={tMid + tSpan} left="fewer points" right="more points"
            marks={[
              { v: tl, label: "Line", kind: "market" },
              { v: et, label: "Model", kind: "model" },
              ...(fa.l10 ? [{ v: fa.l10.total, label: `${A} avg`, kind: "ref" as const }] : []),
              ...(fh.l10 ? [{ v: fh.l10.total, label: `${H} avg`, kind: "ref" as const }] : []),
            ]} />
          <p className="cfoot">Team averages are the combined score in each team&apos;s last 10 games.</p>
        </section>
      )}

      {(fa.last.length > 0 || fh.last.length > 0) && (
        <section className="chart">
          <h3>Form: last 10 games</h3>
          {formVerdict && <p className="cverdict">{formVerdict}</p>}
          {atsVerdict && <p className="csub">{atsVerdict}</p>}
          <div className="grid2 tight">
            {[{ t: g.away, f: fa }, { t: g.home, f: fh }].map(({ t, f }) => (
              <div key={t.id}>
                <div className="mhead"><b>{t.abbr}</b> <span className="muted">{f.l10 ? `${f.l10.w}-${f.l10.l}` : ""}{f.streak ? ` · ${f.streak}` : ""}</span></div>
                <MarginBars results={f.last} season={g.season} opp={abbr} />
                <div className="betform">
                  <span>Against the spread <b>{f.ats.n ? `${f.ats.w}-${f.ats.l}${f.ats.p ? `-${f.ats.p}` : ""}` : "—"}</b>{f.ats.n ? <small> last {f.ats.n}</small> : null}</span>
                  <span>Over / under <b>{f.ou.n ? `${f.ou.o}-${f.ou.u}${f.ou.p ? `-${f.ou.p}` : ""}` : "—"}</b>{f.ou.n ? <small> last {f.ou.n}</small> : null}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="cfoot">Bar height is the winning or losing margin (capped at 30). Faded bars are last season.</p>
        </section>
      )}

      {edgeRows.length > 0 && (
        <section className="chart">
          <h3>Head to head on the numbers</h3>
          {edgeVerdict && <p className="cverdict">{edgeVerdict}</p>}
          <EdgeRows away={A} home={H} rows={edgeRows} />
          {h2h.length > 0 && (
            <p className="cfoot">
              Last {h2h.length} meetings: {h2h.map((x) => `${x.home_score > x.away_score ? abbr(x.home_team_id) : abbr(x.away_team_id)} by ${Math.abs(x.home_score - x.away_score)}`).join(" · ")}
            </p>
          )}
        </section>
      )}

      {/* 3 — everything else, folded away */}
      <details className="more">
        <summary>Full numbers: injuries, game logs, lines, model detail</summary>

        {!g.completed && (
          <div className="section">
            <h3>Injury report</h3>
            {injuries.length === 0 ? <p className="muted">No players listed for either team.</p> : (
              <div className="tablewrap" style={{ marginTop: 8 }}>
                <table className="mvm">
                  <thead><tr><th>Player</th><th>Team</th><th>Status</th><th>Injury</th><th>Est. return</th></tr></thead>
                  <tbody>
                    {[g.away, g.home].flatMap((t) => injuries.filter((i) => i.team_id === t.id).map((i) => (
                      <tr key={i.player_id}>
                        <td>{i.name}{i.key ? " ★" : ""}{i.mpg != null ? <span className="muted"> · {Number(i.mpg).toFixed(1)} min/g</span> : null}</td>
                        <td data-l="Team">{t.abbr}</td>
                        <td data-l="Status">{i.status}</td>
                        <td data-l="Injury">{[i.side, i.injury_type, i.detail].filter((x) => x && x !== "Not Specified").join(" ") || "—"}</td>
                        <td data-l="Est. return" className="num">{i.return_date ?? "—"}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 13 }}>★ = key player (28+ minutes and 15+ points a game). Source: ESPN.</p>
          </div>
        )}

        <div className="section grid2">
          {[{ t: g.away, f: fa }, { t: g.home, f: fh }].map(({ t, f }: { t: Team; f: Form }) => (
            <div key={t.id}>
              <h3>{t.short_name}: last 10</h3>
              <div style={{ margin: "6px 0" }}><Strip f={f} /></div>
              <table>
                <tbody>
                  {f.last.map((r) => (
                    <tr key={r.id} className={r.season !== g.season ? "muted" : ""}>
                      <td className="num" style={{ width: 64 }}>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(r.date))}</td>
                      <td>{r.home ? "vs" : "@"} {abbr(r.oppId)}</td>
                      <td className="num">{r.win ? "W" : "L"} {r.pf}-{r.pa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {p && (
          <div className="section">
            <h3>Model vs market</h3>
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table className="mvm">
                <thead><tr><th>Market</th><th>Line</th><th>Model view</th><th>Model probability</th></tr></thead>
                <tbody>
                  <tr><td>Moneyline</td><td className="num" data-l="Line">{A} {american(p.market_ml_away)} / {H} {american(p.market_ml_home)}</td><td className="num" data-l="Model view">Market implies {H} {pct(p.market_home_prob, 1)}</td><td className="num" data-l="Model probability">{H} {pct(p.home_win_prob, 1)}</td></tr>
                  <tr><td>Spread</td><td className="num" data-l="Line">{H} {signed(p.market_spread_home)}</td><td className="num" data-l="Model view">{H} {signed(-Number(p.exp_margin))}</td><td className="num" data-l="Model probability">{H} covers {pct(p.home_cover_prob, 1)}</td></tr>
                  <tr><td>Total</td><td className="num" data-l="Line">{p.market_total ?? "—"}</td><td className="num" data-l="Model view">{Number(p.exp_total).toFixed(1)}</td><td className="num" data-l="Model probability">Over {pct(p.over_prob, 1)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {p.locked ? "Locked at tip-off" : "Updates until tip-off"} · computed {etDateTime(p.updated_at)} · {p.model_version} · Elo {A} {Number(p.away_elo).toFixed(0)}, {H} {Number(p.home_elo).toFixed(0)}
            </p>
          </div>
        )}

        <div className="section">
          <h3>Line movement</h3>
          {odds.length === 0 ? <p className="muted">No lines captured yet.</p> : (
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Captured</th><th className="num">{H} spread</th><th className="num">Total</th><th className="num">{A} ML</th><th className="num">{H} ML</th></tr></thead>
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
      </details>
    </>
  );
}
