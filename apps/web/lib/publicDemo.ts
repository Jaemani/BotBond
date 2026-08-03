export type PublicDemoBehavior = "normal" | "scope-denied" | "abandon";

export type PublicDemoRun = {
  runId: string;
  behavior: PublicDemoBehavior;
  sessionId: string;
  token: string;
  expiresAt: string;
  eventStream: string;
  policyHash: string;
  bondAccount: string;
  openTransaction: {
    signature: string;
    explorerUrl: string;
    cluster: string;
    status: "CONFIRMED";
  };
  execution: {
    bond: "LIVE_SOLANA_DEVNET";
    intentCompiler: "VERTEX_AI" | "FAKE";
    usagePayment: "HMAC_DEMO_BRIDGE";
    sponsored: true;
  };
};

type Progress = (message: string) => void;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.text();
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try { code = (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? code; } catch { /* keep status */ }
    throw new Error(code);
  }
  return body ? JSON.parse(body) as T : {} as T;
}

export async function createPublicDemoRun(
  behavior: PublicDemoBehavior,
  onWaiting?: Progress,
): Promise<PublicDemoRun> {
  // The sponsor wallet and merchant fixture are intentionally serialized.
  // Do not make a reviewer manually retry while another bond-open is confirming.
  for (let attempt = 0; attempt < 48; attempt += 1) {
    try {
      return await requestJson<PublicDemoRun>("/gateway/v1/public-demo-runs", {
        method: "POST",
        body: JSON.stringify({ behavior }),
      });
    } catch (cause) {
      if (!(cause instanceof Error) || cause.message !== "PUBLIC_DEMO_BUSY" || attempt === 47) throw cause;
      onWaiting?.("Another agent is opening a devnet bond · retrying automatically…");
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }
  throw new Error("PUBLIC_DEMO_BUSY");
}

export async function executePublicDemoRun(run: PublicDemoRun, progress: Progress): Promise<void> {
  const base = `/gateway/v1/access/${encodeURIComponent(run.sessionId)}`;
  const headers = { "x-botbond-session-token": run.token };
  progress("Reading the signed product scope");
  await requestJson(`${base}/products`, { headers });

  if (run.behavior === "scope-denied") {
    progress("Attempting a forbidden seller-contact request");
    const denied = await fetch(`${base}/seller-contacts`, { headers, cache: "no-store" });
    if (denied.status !== 403) throw new Error(`SCOPE_DENIAL_EXPECTED_${denied.status}`);
    progress("Scope blocked before origin · closing session");
    await requestJson(`/gateway/v1/sessions/${encodeURIComponent(run.sessionId)}/close`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": `public-close-${run.runId}` },
      body: "{}",
    });
    return;
  }

  progress("Checking live inventory");
  await requestJson(`${base}/products/lap-2/inventory`, { headers });
  progress("Creating a bonded last-unit reservation");
  const reservation = await requestJson<{ reservationId: string; expiresAt: string }>(`${base}/reservations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ productId: "lap-2", quantity: 1 }),
  });

  if (run.behavior === "normal") {
    progress("Releasing the reservation and returning the bond");
    await requestJson(`${base}/reservations/${encodeURIComponent(reservation.reservationId)}/release`, {
      method: "POST",
      headers,
      body: "{}",
    });
    await requestJson(`/gateway/v1/sessions/${encodeURIComponent(run.sessionId)}/close`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": `public-close-${run.runId}` },
      body: "{}",
    });
    return;
  }

  progress("Reservation left open · waiting for the signed TTL");
  const waitMs = Math.max(0, new Date(reservation.expiresAt).getTime() - Date.now() + 1_250);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  progress("TTL expired · executing bounded settlement");
  await requestJson(`${base}/reservations/${encodeURIComponent(reservation.reservationId)}/expire`, {
    method: "POST",
    headers,
    body: "{}",
  });
}
