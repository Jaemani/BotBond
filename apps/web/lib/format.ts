const DECIMALS = 6;

/**
 * Money is always shown to the same precision so the columns read as one
 * currency. Sub-cent amounts round up to 0.01 rather than printing 0.008,
 * which would look like a different unit next to 1.00.
 */
export function usdc(atomic: number): string {
  const v = atomic / 10 ** DECIMALS;
  if (v > 0 && v < 0.01) return "0.01";
  return v.toFixed(2);
}

export function shortSig(sig: string): string {
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}

export function shortHash(hash: string | null): string {
  if (!hash) return "—";
  const body = hash.replace(/^sha256:/, "");
  return `${body.slice(0, 8)}…${body.slice(-8)}`;
}

export function explorerUrl(sig: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
}

export function clockFrom(iso: string): string {
  return new Date(iso).toISOString().slice(14, 22);
}
