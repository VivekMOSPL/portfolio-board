const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Paise (integer) to a rupee string, e.g. 125000000 -> "₹12,50,000". */
export function formatRupees(paise: number): string {
  const safe = Number.isFinite(paise) ? paise : 0;
  return inr.format(Math.round(safe) / 100);
}

/** Compact rupee string for headline numbers, e.g. "₹1.25 Cr" / "₹4.80 L". */
export function formatRupeesCompact(paise: number): string {
  const rupees = (Number.isFinite(paise) ? paise : 0) / 100;
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)} L`;
  return inr.format(rupees);
}
