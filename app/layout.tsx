import type { Metadata } from "next";
import { Oswald, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Oswald({ subsets: ["latin"], weight: ["600", "700"], variable: "--f-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "Stakeman — NBA model picks",
  description: "Model-driven NBA picks for moneyline and spread. Every pick locked at tip-off and graded in public.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="mast">
          <div className="wrap">
            <Link href="/" className="brand">Stake<span>man</span></Link>
            <nav className="nav">
              <Link href="/">Picks</Link>
              <Link href="/record">Record</Link>
              <Link href="/method">Method</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="foot">
          <div className="wrap">
            <div className="foot-top">
              <div className="foot-brand">
                <div className="brand">Stake<span>man</span></div>
                <p>NBA win and spread probabilities from a statistical model. Every pick is locked at tip-off and graded in public.</p>
              </div>
              <nav className="foot-nav" aria-label="Footer">
                <div>
                  <h4>Stakeman</h4>
                  <Link href="/">Today&apos;s picks</Link>
                  <Link href="/record">Record</Link>
                  <Link href="/method">How it works</Link>
                  <a href="https://x.com/stakemanpicks">@stakemanpicks on X</a>
                </div>
                <div>
                  <h4>Legal</h4>
                  <Link href="/terms">Terms of Use</Link>
                  <Link href="/privacy">Privacy Policy</Link>
                  <Link href="/responsible">Responsible play</Link>
                </div>
              </nav>
            </div>
            <div className="foot-legal">
              <p><b>For information and entertainment only.</b> Stakeman is not a sportsbook and does not offer betting, financial or legal advice. No pick is guaranteed, and you can lose money betting. Past results do not guarantee future results.</p>
              <p><b>21+.</b> Only bet where sports betting is legal for you. Gambling problem? Call or text <b>1-800-GAMBLER</b>.</p>
              <p>Scores, injuries and lines come from ESPN; lines are DraftKings at the time captured and refresh about every 15 minutes. Stakeman is not affiliated with the NBA, ESPN, DraftKings or any sportsbook.</p>
              <p>© {new Date().getFullYear()} Stakeman</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
