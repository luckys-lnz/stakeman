// Stakeman → X. Posts the day's picks before the first tip and the graded results after the slate ends.
// Actions: ?action=whoami (checks keys, read-only) | draft[&slate=YYYY-MM-DD] (no posting) | auto (cron; posts when due, once per slate+kind)
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "stakeman-elo-v1.5";
const LAUNCH = "2026-10-23";           // first live slate
// No URLs in post text: X charges ~13x more for a post containing a link. The site is linked from the profile bio.
const PICKS_LEAD_MIN = 60;             // post picks this long before the slate's first tip
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------- OAuth 1.0a ----------
const env = (k: string) => Deno.env.get(k)?.trim().replace(/^["']|["']$/g, "");
// shape of each secret (never the value) to diagnose paste mistakes
const shape = () => Object.fromEntries(["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"].map((k) => {
  const raw = Deno.env.get(k) ?? ""; const v = env(k) ?? "";
  return [k, { set: !!raw, length: v.length, had_spaces_or_quotes: raw !== v, has_dash: v.includes("-") }];
}));
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function xfetch(method: string, url: string, body?: unknown) {
  const ck = env("X_API_KEY"), cs = env("X_API_SECRET"), at = env("X_ACCESS_TOKEN"), as = env("X_ACCESS_TOKEN_SECRET");
  if (!ck || !cs || !at || !as) throw new Error("missing X secrets");
  const u = new URL(url);
  const o: Record<string, string> = {
    oauth_consumer_key: ck, oauth_nonce: crypto.randomUUID().replace(/-/g, ""), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: at, oauth_version: "1.0",
  };
  const all = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
  const base = [method, enc(u.origin + u.pathname), enc(all.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  o.oauth_signature = await hmac(`${enc(cs)}&${enc(as)}`, base);
  const auth = "OAuth " + Object.entries(o).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
  const r = await fetch(url, { method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

// ---------- helpers ----------
const etDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); // YYYY-MM-DD
const label = (slate: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(slate + "T12:00:00Z"));
const sgn = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${Number(x.toFixed(1))}`);
const am = (x: number) => `${x > 0 ? "+" : ""}${x}`;
const stars = (kind: "ml" | "prob", x: number) => "★".repeat(1 + (kind === "ml" ? [0.03, 0.04, 0.055, 0.07] : [0.5475, 0.555, 0.565, 0.58]).filter((c) => x >= c).length);
const mlUnits = (odds: number) => (odds > 0 ? odds / 100 : 100 / -odds);
const u2 = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}u`;

type Row = { line: string; res?: string; units?: number };

async function slateGames(slate: string) {
  // an ET date spans 04:00Z that day to 04:00Z (or 05:00Z) the next; take a wide window and filter by ET date
  const from = new Date(slate + "T00:00:00Z"), to = new Date(from.getTime() + 36 * 3600e3);
  const { data, error } = await sb.from("games")
    .select("id,start_time,state,completed,home_score,away_score,home:teams!games_home_team_id_fkey(abbr),away:teams!games_away_team_id_fkey(abbr),predictions(*)")
    .neq("season_type", 1).gte("start_time", from.toISOString()).lte("start_time", to.toISOString()).order("start_time");
  if (error) throw error;
  return (data ?? []).filter((g: any) => etDate(new Date(g.start_time)) === slate)
    .map((g: any) => ({ ...g, p: (g.predictions ?? []).find((p: any) => p.model_version === MODEL) }));
}

function pickRows(games: any[]): Row[] {
  const rows: Row[] = [];
  for (const g of games) {
    const p = g.p; if (!p) continue;
    const H = g.home.abbr, A = g.away.abbr;
    if (p.ml_pick) {
      const odds = Number(p.ml_pick === "home" ? p.market_ml_home : p.market_ml_away);
      const t = p.ml_pick === "home" ? H : A;
      const units = p.ml_result === "win" ? mlUnits(odds) : p.ml_result === "loss" ? -1 : undefined;
      rows.push({ line: `${t} to win ${am(odds)} ${stars("ml", Number(p.ml_edge))}`, res: p.ml_result ?? undefined, units });
    }
    if (p.spread_pick) {
      const t = p.spread_pick === "home" ? H : A;
      const units = p.spread_result === "win" ? 100 / 110 : p.spread_result === "loss" ? -1 : p.spread_result === "push" ? 0 : undefined;
      const line = Number(p.spread_line) * (p.spread_pick === "home" ? 1 : -1); // stored line is the home team's
      rows.push({ line: `${t} ${sgn(line)} ${stars("prob", Number(p.spread_pick_prob))}`, res: p.spread_result ?? undefined, units });
    }
  }
  return rows;
}

// split into a thread: each post ≤ 260 chars (emoji-free, so length ≈ X's weighted length)
function thread(head: string, lines: string[], tail: string) {
  const posts: string[] = []; let cur = head;
  for (const l of lines) {
    if ((cur + "\n" + l).length > 230) { posts.push(cur); cur = l; } else cur += "\n" + l;
  }
  cur += "\n\n" + tail; posts.push(cur);
  return posts.length > 1 ? posts.map((p, i) => `${p}${i < posts.length - 1 ? `\n(${i + 1}/${posts.length})` : ""}`) : posts;
}

function picksPost(slate: string, games: any[]) {
  const rows = pickRows(games.filter((g) => g.state === "pre"));
  if (!rows.length) return [`Stakeman · ${label(slate)}\n\nNo picks today. The model found no edge big enough to bet on any game.\n\nEvery game's numbers: link in bio.`];
  return thread(`Stakeman picks · ${label(slate)}\n`, rows.map((r) => r.line), `Picks can change until tip-off. Final card and full record: link in bio.`);
}

async function liveRecord() {
  const { data } = await sb.from("predictions")
    .select("ml_pick,ml_result,spread_pick,spread_result,market_ml_home,market_ml_away,games!inner(start_time)")
    .eq("model_version", MODEL).not("graded_at", "is", null).gte("games.start_time", LAUNCH + "T12:00:00Z");
  let w = 0, l = 0, pu = 0, u = 0;
  for (const p of data ?? []) {
    if (p.ml_pick && p.ml_result) {
      const o = Number(p.ml_pick === "home" ? p.market_ml_home : p.market_ml_away);
      if (p.ml_result === "win") { w++; u += mlUnits(o); } else { l++; u -= 1; }
    }
    if (p.spread_pick && p.spread_result) {
      if (p.spread_result === "win") { w++; u += 100 / 110; } else if (p.spread_result === "loss") { l++; u -= 1; } else pu++;
    }
  }
  return `${w}–${l}${pu ? `–${pu}` : ""} (${u2(u)})`;
}

async function resultsPost(slate: string, games: any[]) {
  const rows = pickRows(games).filter((r) => r.res);
  if (!rows.length) return null;
  const w = rows.filter((r) => r.res === "win").length, l = rows.filter((r) => r.res === "loss").length, p = rows.filter((r) => r.res === "push").length;
  const u = rows.reduce((s, r) => s + (r.units ?? 0), 0);
  const lines = rows.map((r) => `${r.res === "win" ? "W" : r.res === "loss" ? "L" : "P"}  ${r.line.replace(/ ★+$/, "")}  ${r.res === "push" ? "push" : u2(r.units!)}`);
  const tail = `Night: ${w}–${l}${p ? `–${p}` : ""} (${u2(u)})\nLive record: ${await liveRecord()}\n\nEvery pick is graded in public. Link in bio.`;
  return thread(`Stakeman results · ${label(slate)}\n`, lines, tail);
}

async function publish(slate: string, kind: "picks" | "results", posts: string[]) {
  // claim the slot first so a concurrent run can't double-post
  const { error } = await sb.from("x_posts").insert({ slate, kind, body: posts });
  if (error) return { skipped: "already posted" };
  const ids: string[] = [];
  try {
    for (const text of posts) {
      const j = await xfetch("POST", "https://api.x.com/2/tweets", ids.length ? { text, reply: { in_reply_to_tweet_id: ids[ids.length - 1] } } : { text });
      ids.push(j.data.id);
    }
  } catch (e) {
    if (!ids.length) await sb.from("x_posts").delete().eq("slate", slate).eq("kind", kind); // nothing went out; allow retry
    else await sb.from("x_posts").update({ tweet_ids: ids }).eq("slate", slate).eq("kind", kind);
    throw e;
  }
  await sb.from("x_posts").update({ tweet_ids: ids, posted_at: new Date().toISOString() }).eq("slate", slate).eq("kind", kind);
  return { posted: ids };
}

async function auto() {
  const now = new Date(), out: any[] = [];
  // picks for today's slate
  const today = etDate(now);
  const g = await slateGames(today);
  const pre = g.filter((x: any) => x.state === "pre");
  if (pre.length) {
    const first = new Date(pre[0].start_time).getTime();
    if (now.getTime() >= first - PICKS_LEAD_MIN * 60e3 && g[0].state === "pre") out.push({ today, ...(await publish(today, "picks", picksPost(today, g))) });
  }
  // results for the most recent finished slates (yesterday and today)
  for (const s of [etDate(new Date(now.getTime() - 24 * 3600e3)), today]) {
    if (s < LAUNCH) continue;
    const sg = await slateGames(s);
    if (!sg.length || !sg.every((x: any) => x.completed && x.p?.graded_at)) continue;
    const posts = await resultsPost(s, sg);
    if (posts) out.push({ s, ...(await publish(s, "results", posts)) });
  }
  return out;
}

Deno.serve(async (req) => {
  const url = new URL(req.url); const action = url.searchParams.get("action") ?? "draft";
  try {
    if (action === "whoami") {
      try { return Response.json(await xfetch("GET", "https://api.x.com/2/users/me")); }
      catch (e) { return Response.json({ error: String((e as Error).message), secrets: shape() }, { status: 500 }); }
    }
    if (action === "draft") {
      const slate = url.searchParams.get("slate") ?? etDate(new Date());
      const g = await slateGames(slate);
      return Response.json({ slate, picks: picksPost(slate, g.map((x: any) => ({ ...x, state: "pre" }))), results: await resultsPost(slate, g) });
    }
    if (action === "auto") return Response.json({ ok: true, done: await auto() });
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
});
