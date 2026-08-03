"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  Check,
  CheckCircle,
  Circle,
  ClockCountdown,
  Code,
  FileCode,
  LockKey,
  MagnifyingGlass,
  Package,
  ShieldCheck,
  ShoppingBag,
  Sparkle,
  Star,
  TerminalWindow,
  User,
  Wallet,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { BotBondEventType, Fixture, ViewState } from "@/lib/types";
import { explorerUrl, shortHash, shortSig, usdc } from "@/lib/format";
import type { LiveEventStream } from "@/lib/usePlayer";
import { usePlayer } from "@/lib/usePlayer";

const SCENARIOS = [
  { id: "01-normal-session", label: "Complete purchase", detail: "Allowed calls · full bond returned" },
  { id: "02-scope-denied", label: "Request private data", detail: "403 blocked · no penalty" },
  { id: "03-abandoned-reservation", label: "Abandon last-unit hold", detail: "TTL expiry · bounded settlement" },
];

type Surface = "shop" | "agent" | "operations";

function liveStreamFromLocation(): LiveEventStream | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("sessionId");
  const token = params.get("token");
  if (!sessionId || !token) return null;
  const gateway = (params.get("gateway") ?? "/gateway").replace(/\/$/, "");
  return { url: `${gateway}/v1/sessions/${encodeURIComponent(sessionId)}/events`, token };
}

function cursorAfter(fixture: Fixture | null, type: BotBondEventType): number {
  const index = fixture?.events.findIndex((event) => event.type === type) ?? -1;
  return index < 0 ? 0 : index + 1;
}

function stageFor(v: ViewState): number {
  if (v.bondPhase === "RETURNED" || v.sessionState === "CLOSED" || v.sessionState === "VIOLATED") return 5;
  if (v.sessionState === "ACTIVE" || v.sessionState === "EXPIRED") return 4;
  if (v.policy) return 3;
  if (v.task) return 2;
  return 1;
}

function CommerceHeader({
  surface,
  setSurface,
  live,
  liveStatus,
}: {
  surface: Surface;
  setSurface: (surface: Surface) => void;
  live: boolean;
  liveStatus: string;
}) {
  return (
    <header className="commerce-header">
      <button className="shop-brand" onClick={() => setSurface("shop")} aria-label="BShop home">
        <span className="shop-brand-mark">B</span><span>BShop</span>
      </button>
      <nav className="surface-nav" aria-label="BShop navigation">
        <button data-active={surface === "shop"} onClick={() => setSurface("shop")}>Shop</button>
        <button data-active={surface === "agent"} onClick={() => setSurface("agent")}>Agent API</button>
        <button data-active={surface === "operations"} onClick={() => setSurface("operations")}>Merchant Ops</button>
      </nav>
      <div className="commerce-meta">
        {live && <span className="live-connection"><Circle weight="fill" /> LIVE · {liveStatus}</span>}
        <span className="protected-label"><ShieldCheck weight="fill" /> Agent access by BotBond</span>
      </div>
    </header>
  );
}

function StoreNav() {
  return (
    <nav className="store-nav" aria-label="Store navigation">
      <div className="store-links">
        <a href="#product">Shop</a>
        <a href="#product">Categories <CaretDown /></a>
        <a href="#business">For Business</a>
        <a href="#support">Support</a>
      </div>
      <div className="store-actions" aria-label="Store actions">
        <button aria-label="Search"><MagnifyingGlass /></button>
        <button aria-label="Account"><User /></button>
        <button aria-label="Cart" className="cart-button"><ShoppingBag /><span>1</span></button>
      </div>
    </nav>
  );
}

function ProductDetail({ stock, onAddToCart, onAgentAccess }: { stock: number; onAddToCart: () => void; onAgentAccess: () => void }) {
  return (
    <section className="product-detail" id="product">
      <div className="breadcrumbs">Home <span>/</span> Laptops <span>/</span> NovaBook Air</div>
      <div className="product-grid">
        <div className="product-image-wrap">
          <Image src="/assets/novabook-air.png" alt="Graphite NovaBook Air laptop" fill priority sizes="(max-width: 900px) 100vw, 42vw" />
        </div>
        <div className="product-copy">
          <span className="eyebrow">NOVA SERIES</span>
          <h1>NovaBook Air</h1>
          <div className="rating" aria-label="Rated 5 out of 5"><span className="rating-icons" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <Star weight="fill" key={index} />)}</span> (128)</div>
          <div className="price">1,499.00 USDC</div>
          <p className="subtle">Or pay with USDC. <a href="#learn">Learn more</a></p>
          <div className="specs">13.6″ Liquid Retina · M3 Chip · 16GB RAM · 512GB SSD</div>
          <div className={stock === 0 ? "last-unit sold-out" : "last-unit"}><WarningCircle weight="duotone" /><div><strong>{stock === 0 ? "Temporarily held" : `Last unit · ${stock} available`}</strong><span>{stock === 0 ? "An agent reservation currently holds this item." : "Order now to secure the final unit."}</span></div></div>
          <div className="buy-row"><label>Quantity<select defaultValue="1" disabled={stock === 0}><option>1</option></select></label><button onClick={onAddToCart} disabled={stock === 0}>{stock === 0 ? "Unavailable" : "Add to cart"}</button></div>
          <p className="checkout-note"><ShieldCheck weight="duotone" /> Automated buyers can use our <button onClick={onAgentAccess}>official Agent API</button></p>
        </div>
      </div>
      <div className="benefits">
        <div><Package /><span><strong>Fast, free shipping</strong><small>Orders ship in 1–2 business days.</small></span></div>
        <div><ShieldCheck /><span><strong>Full warranty</strong><small>1-year limited warranty included.</small></span></div>
        <div><ClockCountdown /><span><strong>30-day returns</strong><small>Easy returns, no restocking fees.</small></span></div>
      </div>
    </section>
  );
}

function Storefront({ stock, onAddToCart, onAgentAccess }: { stock: number; onAddToCart: () => void; onAgentAccess: () => void }) {
  return <main className="shop-surface"><div className="shop-announcement">Free shipping on business laptop orders · Live inventory</div><StoreNav /><ProductDetail stock={stock} onAddToCart={onAddToCart} onAgentAccess={onAgentAccess} /></main>;
}

function CartDrawer({ open, placed, onClose, onCheckout }: { open: boolean; placed: boolean; onClose: () => void; onCheckout: () => void }) {
  if (!open) return null;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}>
    <div className="drawer-head"><strong>{placed ? "Order confirmed" : "Your cart"}</strong><button onClick={onClose} aria-label="Close cart"><X /></button></div>
    {placed ? <div className="order-success"><CheckCircle weight="duotone" /><h2>NovaBook Air is yours.</h2><p>Order BSH-2048 has been placed. This is the normal human checkout path—no agent bond required.</p><button className="primary-action" onClick={onClose}>Continue shopping</button></div> : <>
      <div className="cart-line"><Image src="/assets/novabook-air.png" alt="NovaBook Air" width={112} height={84} /><div><strong>NovaBook Air</strong><span>Graphite · 512GB</span><b>1,499.00 USDC</b></div></div>
      <div className="cart-total"><span>Total</span><strong>1,499.00 USDC</strong></div>
      <button className="primary-action" onClick={onCheckout}>Checkout</button>
    </>}
  </aside></div>;
}

function AccessDenied({ onContinue, live }: { onContinue: () => void; live: boolean }) {
  return (
    <main className="agent-portal">
      <div className="portal-intro"><span className="eyebrow">BSHOP AGENT API</span><h1>Buy from BShop without an API key.</h1><p>Unknown agents start with no access. Submit a bounded job and refundable bond to receive a short-lived session.</p></div>
      <div className="api-entry-grid">
        <section className="api-request-builder">
          <div className="section-head"><div><TerminalWindow /><strong>Request tester</strong></div><span className="client-badge">ProcureKit · unregistered</span></div>
          <label>Endpoint<div className="endpoint-input"><span>GET</span><code>/products/novabook-air/inventory</code><button aria-label="Send request"><ArrowRight /></button></div></label>
          <div className="response-block denied"><div><span>Response</span><strong>403 Forbidden</strong></div><pre>{`{\n  "error": "UNKNOWN_AUTOMATED_CLIENT",\n  "agent_access": "/.well-known/agent-access"\n}`}</pre></div>
        </section>
        <aside className="official-lane">
          <span className="official-icon"><ShieldCheck weight="duotone" /></span>
          <span className="eyebrow">OFFICIAL ACCESS LANE</span>
          <h2>Restricted access is available.</h2>
          <p>BShop accepts unknown agents when purpose, cost and behavior are bounded in advance.</p>
          <ul><li><Check /> No account or API-key review</li><li><Check /> Merchant-specific least privilege</li><li><Check /> Refundable on-chain bond</li></ul>
          <button className="primary-action" onClick={onContinue} disabled={live}><LockKey /> {live ? "Waiting for live gateway events" : "Request bounded access"}<ArrowRight /></button>
          <div className="discovery-note"><Code /> Discovered at <code>/.well-known/agent-access</code></div>
        </aside>
      </div>
    </main>
  );
}

function IntentRequest({ v, onCompile, live }: { v: ViewState; onCompile: () => void; live: boolean }) {
  const [draft, setDraft] = useState(v.task ?? "Compare the price and live inventory of up to 20 laptops under 1,500 USDC. Do not access seller contacts or customer reviews.");
  return (
    <main className="workspace narrow-workspace">
      <div className="workspace-heading"><span className="eyebrow">BSHOP ACCESS REQUEST</span><h1>Describe the job, not the API.</h1><p>BShop converts this request into the smallest enforceable scope supported by its catalog.</p></div>
      <section className="intent-card">
        <div className="agent-identity"><span><TerminalWindow weight="duotone" /></span><div><strong>ProcureKit Agent</strong><small>Unregistered · wallet 7Yq4…sP2a</small></div><span className="identity-status">UNKNOWN</span></div>
        <label className="intent-field">Purpose<textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <div className="request-constraints"><label>Expected calls<input value="25" readOnly /></label><label>Session duration<input value="5 minutes" readOnly /></label><label>Maximum usage<input value="0.20 USDC" readOnly /></label></div>
        <div className="compiler-explainer"><Sparkle weight="duotone" /><div><strong>Gemini Intent Compiler</strong><span>Maps this natural-language job to BShop’s endpoint and field catalog. It cannot settle or slash funds.</span></div></div>
        <button className="primary-action" onClick={onCompile} disabled={live || draft.trim().length === 0}><Sparkle /> {live ? "Waiting for compiled policy" : "Compile access contract"}<ArrowRight /></button>
      </section>
    </main>
  );
}

function PolicyRow({ allowed, path, fields }: { allowed: boolean; path: string; fields: string }) {
  return <div className="policy-row" data-allowed={allowed}><span>{allowed ? <CheckCircle weight="fill" /> : <X weight="bold" />}</span><code>{path}</code><small>{fields}</small></div>;
}

function AccessContract({ v, onActivate, live }: { v: ViewState; onActivate: () => void; live: boolean }) {
  const policy = v.policy;
  return (
    <main className="workspace contract-workspace" id="policy">
      <div className="workspace-heading"><span className="eyebrow">ACCESS CONTRACT</span><h1>Review the scope before money moves.</h1><p>Gateway enforcement uses this signed policy hash. Gemini does not decide violations.</p></div>
      <div className="contract-grid">
        <section className="contract-document">
          <div className="document-head"><div><span>BOTBOND ACCESS MANIFEST</span><strong>{shortHash(v.policyHash)}</strong></div><FileCode weight="duotone" /></div>
          <h2>{policy?.purpose ?? v.task}</h2>
          <div className="policy-list">
            {(policy?.allowedOperations ?? []).map((operation) => <PolicyRow key={`${operation.method}-${operation.pathTemplate}`} allowed path={`${operation.method} ${operation.pathTemplate}`} fields={`${operation.allowedResponseFields.join(", ")} · max ${operation.maxCalls}`} />)}
            {v.excluded.map((entry) => <PolicyRow key={entry.path} allowed={false} path={entry.path} fields={entry.reason} />)}
          </div>
          <div className="signature-row"><span><small>AGENT</small><strong>7Yq4…sP2a</strong></span><span><small>MERCHANT</small><strong>BShop Commerce</strong></span><ShieldCheck weight="duotone" /></div>
        </section>
        <aside className="terms-card">
          <h2>Session terms</h2>
          <dl><div><dt>Usage cap</dt><dd>{usdc(v.usageCapAtomic)} USDC</dd></div><div><dt>Refundable bond</dt><dd>{usdc(v.bondAmountAtomic)} USDC</dd></div><div><dt>Maximum penalty</dt><dd>{usdc(v.maxPenaltyAtomic)} USDC</dd></div><div><dt>Rate</dt><dd>{policy?.constraints.maxRequestsPerMinute ?? 5}/min</dd></div></dl>
          <div className="money-separation"><div><Wallet /><span><strong>Usage</strong><small>pay.sh · paid API requests</small></span></div><div><ShieldCheck /><span><strong>Bond</strong><small>Solana escrow · returned by rule</small></span></div></div>
          <p className="safety-copy"><LockKey /> Only deterministic TTL, rate, endpoint, field and cost rules can trigger settlement.</p>
          <button className="primary-action" onClick={onActivate} disabled={live}><Wallet /> {live ? "Waiting for bond confirmation" : `Lock ${usdc(v.bondAmountAtomic)} USDC & open session`}<ArrowRight /></button>
        </aside>
      </div>
    </main>
  );
}

function ActiveSession({ v, onRun, playing, onPause, scenarioId, live }: { v: ViewState; onRun: () => void; playing: boolean; onPause: () => void; scenarioId: string; live: boolean }) {
  const reservation = v.reservation;
  const expiry = scenarioId === "03-abandoned-reservation";
  const recent = v.trace.slice(-5).reverse();
  return (
    <main className="workspace session-workspace">
      <div className="workspace-heading session-heading"><div><span className="eyebrow">ACTIVE SESSION</span><h1>Scoped access is live.</h1><p>Every response is filtered by the signed manifest before it reaches the agent.</p></div><span className="active-pill"><Circle weight="fill" /> SESSION ACTIVE</span></div>
      <div className="session-grid">
        <section className="request-stream">
          <div className="section-head"><div><TerminalWindow /><strong>Agent requests</strong></div><code>{v.callCount} / {v.policy?.constraints.maxTotalCalls ?? 25} calls</code></div>
          <div className="trace-list">
            {recent.length === 0 && <div className="empty-stream">No scoped calls yet.</div>}
            {recent.map((row) => <div className="trace-item" data-kind={row.kind} key={row.id}><span>{row.kind === "DENIED" ? <X /> : <Check />}</span><div><strong>{row.method} {row.path}</strong><small>{row.detail || row.headline}</small></div><code>{row.kind}</code></div>)}
          </div>
          {!live && <button className="primary-action" onClick={playing ? onPause : onRun}>{playing ? <><ClockCountdown /> Pause demo</> : <><ArrowRight /> {v.callCount > 0 ? "Continue session" : "Run scoped requests"}</>}</button>}
        </section>
        <aside className="inventory-panel">
          <div className="inventory-product"><Image src="/assets/novabook-air.png" alt="NovaBook Air" width={156} height={117} /><div><span className="eyebrow">NOVA SERIES</span><h2>NovaBook Air</h2><p>SKU · lap-2</p></div></div>
          <div className="inventory-count"><span>Live inventory</span><strong>{reservation?.status === "HELD" ? "0" : "1"}</strong><small>unit available</small></div>
          {reservation ? <div className="reservation-card" data-status={reservation.status}><ClockCountdown weight="duotone" /><div><strong>{reservation.status === "HELD" ? "Agent hold active" : reservation.status === "EXPIRED" ? "Inventory restored" : "Hold released"}</strong><span>{reservation.status === "HELD" ? `${reservation.secondsRemaining ?? reservation.ttlSeconds}s remaining · ${expiry ? "expiry settlement enabled" : "release expected"}` : `Reservation ${reservation.status.toLowerCase()} · deterministic event`}</span></div></div> : <div className="reservation-card neutral"><Package /><div><strong>No inventory hold</strong><span>The agent has not created a bonded reservation.</span></div></div>}
          <dl className="bond-monitor"><div><dt>Bond locked</dt><dd>{usdc(v.bondAmountAtomic)} USDC</dd></div><div><dt>Usage so far</dt><dd>{usdc(v.usageSpentAtomic)} USDC</dd></div><div><dt>Penalty ceiling</dt><dd>{usdc(v.maxPenaltyAtomic)} USDC</dd></div></dl>
        </aside>
      </div>
    </main>
  );
}

function SettlementReceipt({ v, fixtureMode, onReset }: { v: ViewState; fixtureMode: boolean; onReset: () => void }) {
  const violated = v.penaltyAtomic > 0;
  return (
    <main className="workspace receipt-workspace">
      <div className="receipt-status"><span className={violated ? "warning" : "success"}>{violated ? <WarningCircle weight="duotone" /> : <CheckCircle weight="duotone" />}</span><div><span className="eyebrow">SESSION SETTLED</span><h1>{violated ? "Inventory recovered. Penalty bounded." : "Task complete. Bond returned."}</h1><p>{violated ? "The reservation expired by an objective TTL rule. The merchant received only the pre-agreed amount." : "The agent stayed inside scope and released its reservation. Only actual usage was charged."}</p></div></div>
      <section className="receipt-paper">
        <div className="receipt-head"><div><span className="brand-name">BotBond</span><small>Settlement receipt</small></div><span>{v.outcome ?? v.sessionState}</span></div>
        <div className="receipt-money"><div><span>Usage paid</span><strong>{usdc(v.usageSpentAtomic)} <small>USDC</small></strong></div><div><span>Penalty settled</span><strong>{usdc(v.penaltyAtomic)} <small>USDC</small></strong></div><div className="refund"><span>Bond returned</span><strong>{usdc(v.bondRefundedAtomic)} <small>USDC</small></strong></div></div>
        <div className="receipt-evidence"><div><span>Policy hash</span><code>{shortHash(v.policyHash)}</code></div><div><span>Requests</span><code>{v.callCount} allowed · {v.deniedCount} denied</code></div><div><span>Receipt hash</span><code>{shortHash(v.receiptHash)}</code></div></div>
        <div className="tx-list">
          {v.txs.map((tx) => <div key={tx.signature}><span><CheckCircle weight="fill" /><span><strong>{tx.label}</strong><small>{shortSig(tx.signature)} · {tx.status}</small></span></span>{tx.explorerEligible ? <a href={explorerUrl(tx.signature, tx.cluster)} target="_blank" rel="noreferrer">Explorer <ArrowSquareOut /></a> : <span className="fixture-reference">{fixtureMode ? "FIXTURE REFERENCE" : tx.cluster}</span>}</div>)}
        </div>
      </section>
      <div className="receipt-actions"><button className="secondary-action" onClick={onReset}>Start another session</button><span><ShieldCheck /> Rules enforced without an operator decision</span></div>
    </main>
  );
}

function AgentRunSelector({ scenarioId, onChange, disabled }: { scenarioId: string; onChange: (id: string) => void; disabled: boolean }) {
  return <div className="agent-run-selector"><div><span className="eyebrow">CLIENT BEHAVIOR</span><strong>Choose what the external agent attempts</strong></div><div className="run-options">
    {SCENARIOS.map((scenario) => <button key={scenario.id} data-active={scenarioId === scenario.id} onClick={() => onChange(scenario.id)} disabled={disabled}><span>{scenario.label}</span><small>{scenario.detail}</small></button>)}
  </div></div>;
}

function MerchantOperations({ v, onOpenAgent }: { v: ViewState; onOpenAgent: () => void }) {
  const stock = v.reservation?.status === "HELD" ? 0 : 1;
  const latest = v.trace.slice(-6).reverse();
  return <main className="operations-surface">
    <div className="ops-heading"><div><span className="eyebrow">BSHOP MERCHANT OPS</span><h1>Agent commerce activity</h1><p>Inventory and access decisions from the same storefront and Gateway.</p></div><button className="secondary-action" onClick={onOpenAgent}>Open Agent API <ArrowRight /></button></div>
    <section className="ops-kpis"><div><span>NovaBook Air inventory</span><strong>{stock}</strong><small>{stock === 0 ? "Held by an agent" : "Available for checkout"}</small></div><div><span>Session state</span><strong>{v.sessionState}</strong><small>{v.callCount} allowed · {v.deniedCount} denied</small></div><div><span>Bond state</span><strong>{v.bondPhase}</strong><small>{usdc(v.penaltyAtomic)} USDC settled</small></div></section>
    <div className="ops-grid"><section className="access-outcomes"><div className="section-head"><div><ShieldCheck /><strong>How BShop handles automation</strong></div></div>
      <div className="outcome-row"><span className="outcome-icon success"><Check /></span><div><strong>Scoped request</strong><small>Price, stock and reservation calls reach the commerce API.</small></div><b>200</b></div>
      <div className="outcome-row"><span className="outcome-icon denied"><LockKey /></span><div><strong>Unknown or private-data request</strong><small>Blocked before origin; no protected data leaves BShop.</small></div><b>403</b></div>
      <div className="outcome-row"><span className="outcome-icon warning"><ClockCountdown /></span><div><strong>Abandoned reservation</strong><small>Inventory returns after TTL; settlement stays under the signed ceiling.</small></div><b>0.25</b></div>
    </section><section className="ops-feed"><div className="section-head"><div><TerminalWindow /><strong>Current session</strong></div><code>{v.policyHash ? shortHash(v.policyHash) : "No contract yet"}</code></div>
      {latest.length === 0 ? <div className="empty-stream">No agent activity yet. Open the Agent API to send a request.</div> : <div className="ops-events">{latest.map((row) => <div key={row.id}><span data-kind={row.kind}>{row.kind === "DENIED" ? <X /> : <Check />}</span><div><strong>{row.method} {row.path}</strong><small>{row.detail || row.headline}</small></div><time>{new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>)}</div>}
    </section></div>
  </main>;
}

export default function Page() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [live, setLive] = useState<LiveEventStream | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [surface, setSurface] = useState<Surface>("shop");
  const [cartOpen, setCartOpen] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);

  useEffect(() => {
    const stream = liveStreamFromLocation();
    setLive(stream);
    const requestedSurface = new URLSearchParams(window.location.search).get("surface");
    if (stream) setSurface("agent");
    else if (requestedSurface === "agent" || requestedSurface === "operations" || requestedSurface === "shop") setSurface(requestedSurface);
  }, []);

  useEffect(() => {
    if (live) return;
    let cancelled = false;
    setLoadError(null);
    fetch(`/fixtures/${scenarioId}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Fixture ${scenarioId} returned ${response.status}`);
        return response.json();
      })
      .then((data: Fixture) => { if (!cancelled) setFixture(data); })
      .catch((error: Error) => { if (!cancelled) setLoadError(error.message); });
    return () => { cancelled = true; };
  }, [scenarioId, live]);

  const player = usePlayer(fixture, live);
  const v = player.view;
  const stage = stageFor(v);
  const positions = useMemo(() => ({
    intent: cursorAfter(fixture, "INTENT_RECEIVED"),
    policy: cursorAfter(fixture, "POLICY_COMPILED"),
    active: cursorAfter(fixture, "SESSION_ACTIVATED"),
  }), [fixture]);
  const stock = v.reservation?.status === "HELD" ? 0 : 1;
  const changeScenario = (id: string) => {
    setScenarioId(id);
    player.reset();
  };
  const navigateSurface = (next: Surface) => {
    setSurface(next);
    const url = new URL(window.location.href);
    if (next === "shop") url.searchParams.delete("surface");
    else url.searchParams.set("surface", next);
    window.history.replaceState({}, "", url);
  };

  return (
    <div className="app-shell">
      <CommerceHeader surface={surface} setSurface={navigateSurface} live={Boolean(live)} liveStatus={player.liveStatus} />
      {loadError && <div className="load-error">Could not load demo evidence: {loadError}</div>}
      {surface === "shop" && <Storefront stock={stock} onAddToCart={() => { setOrderPlaced(false); setCartOpen(true); }} onAgentAccess={() => navigateSurface("agent")} />}
      {surface === "agent" && <div className="agent-surface"><AgentRunSelector scenarioId={scenarioId} onChange={changeScenario} disabled={Boolean(live) || player.playing} />
        {stage === 1 && <AccessDenied onContinue={() => player.seek(positions.intent)} live={Boolean(live)} />}
        {stage === 2 && <IntentRequest v={v} onCompile={() => player.seek(positions.policy)} live={Boolean(live)} />}
        {stage === 3 && <AccessContract v={v} onActivate={() => player.seek(positions.active)} live={Boolean(live)} />}
        {stage === 4 && <ActiveSession v={v} onRun={player.play} playing={player.playing} onPause={player.pause} scenarioId={scenarioId} live={Boolean(live)} />}
        {stage === 5 && <SettlementReceipt v={v} fixtureMode={v.fixtureMode} onReset={player.reset} />}
      </div>}
      {surface === "operations" && <MerchantOperations v={v} onOpenAgent={() => navigateSurface("agent")} />}
      <CartDrawer open={cartOpen} placed={orderPlaced} onClose={() => setCartOpen(false)} onCheckout={() => setOrderPlaced(true)} />
    </div>
  );
}
