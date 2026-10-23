export const TZ = "America/New_York";

export const pct = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined ? "—" : `${(Number(x) * 100).toFixed(d)}%`;

export const signed = (x: number | null | undefined, d = 1) => {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (n === 0) return "PK";
  return `${n > 0 ? "+" : ""}${n.toFixed(d).replace(/\.0$/, "")}`;
};

export const american = (x: number | null | undefined) =>
  x === null || x === undefined ? "—" : `${Number(x) > 0 ? "+" : ""}${Number(x)}`;

export const etDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export const etTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " ET";

export const etLongDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));

export const etDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " ET";

// profit in units for a 1-unit stake at American odds
export const payout = (odds: number) => (odds > 0 ? odds / 100 : 100 / -odds);
