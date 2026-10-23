export const metadata = { title: "Method — Stakeman" };

export default function Method() {
  return (
    <>
      <section className="hero">
        <div className="kicker">How Stakeman works</div>
        <h1>Method</h1>
        <p>Stakeman is a probability engine, not a tipster. It estimates how likely each outcome is, compares that with the market, and only flags a pick when the gap is large enough to matter.</p>
      </section>

      <div className="section">
        <h3>1 · Team strength</h3>
        <p>Every team carries an Elo rating, updated after each game by how much it won or lost by, adjusted for how expected the result was. Between seasons, ratings regress 40% toward average so roster changes are accounted for. Home court is worth about 1.8 points.</p>
        <h3>2 · Win probability and margin</h3>
        <p>The rating gap converts to a win probability and an expected margin (28 Elo points ≈ 1 point on the scoreboard). Spread cover probability uses the historical spread of outcomes around that margin (σ ≈ 14.6 points).</p>
        <h3>3 · Totals</h3>
        <p>A separate scoring model tracks each team&apos;s recent points scored and allowed against league average to project both scores. Over/under probability uses the historical spread of totals (σ ≈ 20 points).</p>
        <h3>4 · Picks</h3>
        <p>The betting market knows things a ratings model can&apos;t: injuries, trades, rest. So picks come from a blended view, 40% model and 60% market. Moneyline: the blended probability must beat the market&apos;s vig-free implied probability by at least 2.5 points. Spread and total: the blend must give a side at least 54%, above the ~52.4% break-even at −110. Otherwise: pass.</p>
        <p>When the raw model and the market disagree by a lot (more than 6 points on the spread, 12 on the total, or 15 points of win probability), Stakeman doesn&apos;t treat that as an edge. It usually means news the model can&apos;t see, so the game is marked <b>check news</b> instead of picked.</p>
        <h3>5 · Injuries</h3>
        <p>Every 15 minutes Stakeman reads the league injury report and each listed player&apos;s minutes per game. A player averaging 28+ minutes and 15+ points is a key player (★). The ratings model can&apos;t see absences, so it overrates a team missing one. When a key player is out or questionable with an injury reported in the last three weeks, Stakeman withholds picks on that team and overs in that game (<b>injury hold</b>). Picks against the short-handed team still stand. Long-term absences stop triggering holds after three weeks, by which point the market and the team&apos;s recent results already reflect them.</p>
        <h3>6 · Accountability</h3>
        <p>Predictions refresh every 15 minutes until tip-off, then lock. Each one is stored with the model version and data timestamp, and graded automatically after the final buzzer. The record page shows every result.</p>
      </div>

      <div className="section">
        <h3>What the model does not know yet</h3>
        <p>How much each absence is worth in points, confirmed lineups, rest, travel and back-to-backs. Injuries are handled by holding picks, not by adjusting the numbers. Check team news before acting on any pick.</p>
        <div className="callout">Stakeman is for information and entertainment. It is not betting or financial advice. Never stake more than you can afford to lose. 21+ where legal. Gambling problem? Call or text 1-800-GAMBLER.</div>
      </div>
    </>
  );
}
