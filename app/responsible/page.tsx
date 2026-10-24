export const metadata = { title: "Responsible Play — Stakeman" };

export default function Responsible() {
  return (
    <>
      <section className="hero">
        <div className="kicker">Read before you bet</div>
        <h1>Responsible play</h1>
        <p>Stakeman shows what a model thinks. Even a good model loses often. Here&apos;s how to keep betting a choice you control.</p>
      </section>

      <div className="section legal">
        <h2>What to expect from picks</h2>
        <ul>
          <li>Losing runs are normal. In our backtest, the picks lost money in February and March 2026 before recovering.</li>
          <li>A small edge only shows up over hundreds of bets. One night, or one week, tells you almost nothing.</li>
          <li>Never treat a pick as a sure thing, however many stars it has.</li>
        </ul>

        <h2>Simple rules that help</h2>
        <ul>
          <li>Set a budget for the season that you can afford to lose completely, and don&apos;t add to it.</li>
          <li>Bet a small, fixed amount per pick. Stakeman&apos;s record assumes the same 1 unit on every pick.</li>
          <li>Don&apos;t chase losses by betting more to win them back.</li>
          <li>Don&apos;t bet with borrowed money or money meant for bills.</li>
          <li>Use the deposit limits, time-outs and self-exclusion tools your sportsbook offers.</li>
        </ul>

        <h2>Warning signs</h2>
        <p>Betting more than you planned, hiding it from people close to you, feeling anxious when you can&apos;t bet, or betting to escape problems are signs to stop and talk to someone.</p>

        <h2>Get help</h2>
        <div className="callout">
          <p><b>United States:</b> call or text <b>1-800-GAMBLER</b> (1-800-426-2537), free and confidential, any time. Chat at <a href="https://www.ncpgambling.org/help-treatment/">ncpgambling.org</a>.</p>
          <p><b>UK:</b> National Gambling Helpline 0808 8020 133, or <a href="https://www.gamcare.org.uk/">gamcare.org.uk</a>.</p>
          <p><b>Elsewhere:</b> <a href="https://www.gamblingtherapy.org/">gamblingtherapy.org</a> offers free support in many languages.</p>
        </div>
        <p>Stakeman is for people aged 21 and over, where sports betting is legal.</p>
      </div>
    </>
  );
}
