export const metadata = { title: "Privacy Policy — Stakeman" };

const UPDATED = "October 24, 2026";

export default function Privacy() {
  return (
    <>
      <section className="hero">
        <div className="kicker">Last updated {UPDATED}</div>
        <h1>Privacy Policy</h1>
        <p>The short version: Stakeman has no accounts, no sign-up, no tracking cookies and no advertising trackers. We don&apos;t sell or share personal information. This page explains the little data that is involved.</p>
      </section>

      <div className="section legal">
        <h2>1. What we collect</h2>
        <p><b>Nothing you type in.</b> The site has no forms, logins or payments, so we never ask for your name, email or payment details.</p>
        <p><b>Basic server logs.</b> Our hosting provider, Vercel, automatically records technical details of each visit, such as your IP address, browser type, the page requested and the time. It may derive a rough location (country or city) from the IP address. This is standard for any website and is used to deliver pages, keep the site secure and fix problems.</p>
        <p><b>Messages you send us.</b> If you contact us by direct message on X, we receive your X username and whatever you write. We use it only to reply.</p>

        <h2>2. Cookies and tracking</h2>
        <p>Stakeman does not use cookies, analytics tools, advertising pixels or fingerprinting. Fonts are served from our own site, so loading a page does not contact Google or other third parties. If this changes, for example if we add analytics or an email list, we will update this policy first and, where the law requires it, ask for your consent.</p>

        <h2>3. How we use information</h2>
        <ul>
          <li>to run the site and show you pages;</li>
          <li>to keep it secure and investigate misuse; and</li>
          <li>to answer your messages.</li>
        </ul>
        <p>We don&apos;t use your information for advertising, and we don&apos;t build profiles of visitors.</p>

        <h2>4. Who handles it</h2>
        <ul>
          <li><b>Vercel</b> hosts the site and keeps its server logs (<a href="https://vercel.com/legal/privacy-notice">Vercel privacy notice</a>).</li>
          <li><b>Supabase</b> stores Stakeman&apos;s sports data: games, odds, injuries and picks. It holds no visitor information.</li>
          <li><b>X</b> handles anything you do on our X account under its own privacy policy.</li>
        </ul>
        <p>We do not sell, rent or trade personal information. We would disclose it only if the law requires us to.</p>

        <h2>5. How long we keep it</h2>
        <p>Server logs are kept only as long as our hosting provider retains them, typically days to weeks. Messages are kept as long as needed to deal with your request.</p>

        <h2>6. Your choices and rights</h2>
        <p>Depending on where you live (for example California, other US states, the UK or the EU), you may have the right to ask what personal information we hold about you, to have it corrected or deleted, or to object to how it is used. Because we hold almost nothing, most requests will be quick. To make one, send a direct message to <a href="https://x.com/stakemanpicks">@stakemanpicks</a> on X. We won&apos;t treat you differently for making a request.</p>

        <h2>7. Children</h2>
        <p>Stakeman is only for people aged 21 and over. We don&apos;t knowingly collect information from anyone under 21. If you believe a minor has contacted us, let us know and we will delete the message.</p>

        <h2>8. Security</h2>
        <p>The site is served over HTTPS, and our data systems are only reachable with credentials kept on our servers. No system is perfectly secure, but since we don&apos;t collect sensitive personal information, there is little to expose.</p>

        <h2>9. Changes</h2>
        <p>We will post any changes here and update the date at the top.</p>

        <h2>10. Contact</h2>
        <p>Privacy questions or requests: send a direct message to <a href="https://x.com/stakemanpicks">@stakemanpicks</a> on X.</p>
      </div>
    </>
  );
}
