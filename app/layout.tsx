import type { Metadata } from "next";
import { Oswald, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Oswald({ subsets: ["latin"], weight: ["600", "700"], variable: "--f-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "Stakeman — NBA model picks",
  description: "Model-driven NBA probabilities for moneyline, spread and total. Every pick time-stamped and graded in public.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="mast">
          <div className="wrap">
            <Link href="/" className="brand"><img src="/stakeman-mark.svg" alt="" width="34" height="34" />Stake<span>man</span></Link>
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
            <p>Stakeman publishes model probabilities for information and entertainment. Not financial or betting advice. Past results do not guarantee future results.</p>
            <p>21+ where legal. Gambling problem? Call or text 1-800-GAMBLER.</p>
            <p>Lines shown are DraftKings consensus via ESPN at the time captured. Data refreshes every 15 minutes.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
