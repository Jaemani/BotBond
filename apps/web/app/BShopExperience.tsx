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
import {
  createPublicDemoRun,
  executePublicDemoRun,
  type PublicDemoBehavior,
} from "@/lib/publicDemo";

const SCENARIOS = [
  { id: "01-normal-session", label: "Complete purchase", detail: "Allowed calls · full bond returned" },
  { id: "02-scope-denied", label: "Request private data", detail: "403 blocked · no penalty" },
  { id: "03-abandoned-reservation", label: "Abandon last-unit hold", detail: "TTL expiry · bounded settlement" },
];

export type Surface = "overview" | "shop" | "agent" | "developer" | "operations";

type DirectRequestEvidence = {
  status: number;
  statusText: string;
  body: Record<string, unknown>;
  traceId: string | null;
};

type ConnectionProbe = {
  label: string;
  request: string;
  status: number;
  detail: string;
  traceId: string | null;
};

const BEHAVIOR_BY_SCENARIO: Record<string, PublicDemoBehavior> = {
  "01-normal-session": "normal",
  "02-scope-denied": "scope-denied",
  "03-abandoned-reservation": "abandon",
};

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
      <button className="shop-brand" onClick={() => setSurface("overview")} aria-label="BotBond home">
        <span className="shop-brand-mark">B</span><span>BotBond</span>
      </button>
      <nav className="surface-nav" aria-label="BotBond navigation">
        <button data-active={surface === "overview"} onClick={() => setSurface("overview")}>Overview</button>
        <button data-active={surface === "shop"} onClick={() => setSurface("shop")}>Customer Shop</button>
        <button data-active={surface === "agent"} onClick={() => setSurface("agent")}>Agent Console</button>
        <button data-active={surface === "operations"} onClick={() => setSurface("operations")}>Merchant Ops</button>
        <button data-active={surface === "developer"} onClick={() => setSurface("developer")}>Integrate</button>
      </nav>
      <div className="commerce-meta">
        {live && <span className="live-connection"><Circle weight="fill" /> LIVE · {liveStatus}</span>}
        <span className="protected-label"><ShieldCheck weight="fill" /> BShop merchant demo</span>
      </div>
    </header>
  );
}

function BotBondOverview({ onNavigate }: { onNavigate: (surface: Surface) => void }) {
  return <main className="botbond-overview">
    <section className="overview-hero">
      <span className="eyebrow">BONDED AGENT ACCESS</span>
      <h1>Safe API access for unknown AI agents.</h1>
      <p>BotBond lets a merchant reject unknown automation by default, then issue a short-lived API session only after an agent declares its job, accepts a merchant-specific scope and locks a refundable devnet bond for costly actions.</p>
      <div className="overview-actions"><button className="primary-action" onClick={() => onNavigate("agent")}><TerminalWindow />Try the live agent path <ArrowRight /></button><button className="secondary-action" onClick={() => onNavigate("shop")}><ShoppingBag />View the BShop merchant case</button></div>
      <p className="overview-boundary"><ShieldCheck weight="duotone" /> The product does not bypass Cloudflare. A merchant intentionally publishes the agent route.</p>
    </section>
    <section className="overview-flow" aria-label="BotBond access flow">
      <div><span>01</span><strong>Unknown request rejected</strong><p>Direct automated API traffic receives a real Gateway `403` before origin.</p></div>
      <ArrowRight />
      <div><span>02</span><strong>Intent becomes scope</strong><p>Gemini proposes the smallest BShop policy; the Gateway validates and enforces it.</p></div>
      <ArrowRight />
      <div><span>03</span><strong>Bonded action settles by rule</strong><p>A real Solana devnet bond is refunded on completion or settled only for objective TTL expiry.</p></div>
    </section>
    <section className="merchant-case">
      <div><span className="eyebrow">MERCHANT CASE · BSHOP</span><h2>One merchant, four separated experiences.</h2><p>BShop is not the product. It is a realistic merchant integration that makes the same access rule visible to customers, agents, operators and developers.</p></div>
      <div className="merchant-case-links"><button onClick={() => onNavigate("shop")}><User />Customer storefront <ArrowRight /></button><button onClick={() => onNavigate("agent")}><TerminalWindow />Agent console <ArrowRight /></button><button onClick={() => onNavigate("operations")}><ShieldCheck />Merchant protection <ArrowRight /></button><button onClick={() => onNavigate("developer")}><Code />Integration check <ArrowRight /></button></div>
    </section>
  </main>;
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
          <button className="agent-lane-cta" onClick={onAgentAccess}><ShieldCheck weight="duotone" /><span><strong>Buying with an AI agent?</strong><small>Use BShop’s official scoped Agent API instead of the customer checkout.</small></span><ArrowRight /></button>
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
  return <main className="shop-surface"><div className="role-ribbon"><User weight="fill" /> CUSTOMER STOREFRONT <span>Human shopping path</span></div><div className="shop-announcement">Free shipping on business laptop orders · Live inventory</div><StoreNav /><ProductDetail stock={stock} onAddToCart={onAddToCart} onAgentAccess={onAgentAccess} /></main>;
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

function AccessDenied({
  onOpenLive,
  directEvidence,
  directRequesting,
  onDirectRequest,
  live,
}: {
  onOpenLive: () => void;
  directEvidence: DirectRequestEvidence | null;
  directRequesting: boolean;
  onDirectRequest: () => void;
  live: boolean;
}) {
  const responseBody = directEvidence
    ? JSON.stringify(directEvidence.body, null, 2)
    : "Press Send to issue a real request to the deployed BShop Gateway.";
  return (
    <main className="agent-portal">
      <div className="portal-intro"><span className="eyebrow">EXTERNAL AGENT CONSOLE · NOT THE CUSTOMER SHOP</span><h1>Buy from BShop without an API key.</h1><p>Unknown agents start with no access. Submit a bounded job and refundable bond to receive a short-lived session.</p></div>
      <div className="api-entry-grid">
        <section className="api-request-builder">
          <div className="section-head"><div><TerminalWindow /><strong>Request tester</strong></div><span className="client-badge">ProcureKit · unregistered</span></div>
          <label>Endpoint<div className="endpoint-input"><span>GET</span><code>/products</code><button aria-label="Send request to deployed gateway" onClick={onDirectRequest} disabled={directRequesting}>{directRequesting ? <ClockCountdown /> : <ArrowRight />}</button></div></label>
          <div className={`response-block ${directEvidence?.status === 403 ? "denied" : "pending"}`}><div><span>Deployed BShop Gateway · direct request</span><strong>{directEvidence ? `${directEvidence.status} ${directEvidence.statusText}` : "Awaiting request"}</strong></div><pre>{responseBody}</pre>{directEvidence?.traceId && <small>Cloud trace: {directEvidence.traceId.slice(0, 16)}…</small>}</div>
        </section>
        <aside className="official-lane">
          <span className="official-icon"><ShieldCheck weight="duotone" /></span>
          <span className="eyebrow">OFFICIAL ACCESS LANE</span>
          <h2>Restricted access is available.</h2>
          <p>BShop accepts unknown agents when purpose, cost and behavior are bounded in advance.</p>
          <ul><li><Check /> No account or API-key review</li><li><Check /> Merchant-specific least privilege</li><li><Check /> Refundable on-chain bond</li></ul>
          <button className="primary-action" onClick={onOpenLive} disabled={live || directRequesting}><LockKey /> {live ? "Waiting for live gateway events" : "Open a live bounded session"}<ArrowRight /></button>
          <div className="discovery-note"><Code /> Discovered at <code>/.well-known/agent-access</code></div>
        </aside>
      </div>
    </main>
  );
}

function RequestBoundary({ v, stage, live, directAttempted }: { v: ViewState; stage: number; live: boolean; directAttempted: boolean }) {
  const latest = v.deniedCount > 0
    ? [...v.trace].reverse().find((row) => row.kind === "DENIED")
    : v.trace.at(-1);
  const denied = latest?.kind === "DENIED";
  const originReached = latest && !denied && stage >= 4;
  const nodes = [
    { label: "External agent", detail: live ? "Live sponsored client" : "Recorded client", state: "active" },
    { label: "Edge policy", detail: stage === 1 ? directAttempted ? "GET /products → 403 here" : "Direct request not sent" : "Official route allowed", state: stage === 1 ? directAttempted ? "blocked" : "idle" : "passed" },
    { label: "BotBond Gateway", detail: stage < 2 ? "Not reached" : denied ? "Scope blocked here" : stage >= 4 ? "Session enforced" : "Negotiating scope", state: stage < 2 ? "idle" : denied ? "blocked" : "passed" },
    { label: "BShop Origin API", detail: originReached ? "Reached with filtered fields" : "Not reached", state: originReached ? "passed" : "idle" },
  ];
  return <section className="request-boundary"><div className="boundary-heading"><span><ShieldCheck /> REQUEST PATH</span><small>Shows where the current request actually stopped</small></div><div className="boundary-nodes">{nodes.map((node, index) => <div className="boundary-node-wrap" key={node.label}><div className="boundary-node" data-state={node.state}><strong>{node.label}</strong><span>{node.detail}</span></div>{index < nodes.length - 1 && <ArrowRight />}</div>)}</div></section>;
}

function ExecutionTruth({ live }: { live: boolean }) {
  return <section className="execution-truth"><div><span className="truth-dot simulated" /><strong>Edge block</strong><small>BShop demo policy · not a live Cloudflare zone</small></div><div><span className="truth-dot live" /><strong>Intent compiler</strong><small>{live ? "Live Vertex AI Gemini" : "Recorded verified run"}</small></div><div><span className="truth-dot sandbox" /><strong>Usage payment</strong><small>pay.sh x402 sandbox verified · cloud session uses HMAC bridge</small></div><div><span className="truth-dot live" /><strong>Bond settlement</strong><small>{live ? "Live Solana devnet transactions" : "Recorded devnet evidence"}</small></div></section>;
}

function IntentRequest({ v, onCompile, live }: { v: ViewState; onCompile: () => void; live: boolean }) {
  const [draft, setDraft] = useState(v.task ?? "Compare the price and live inventory of up to 20 laptops under 1,500 USDC. Do not access seller contacts or customer reviews.");
  return (
    <main className="workspace narrow-workspace">
      <div className="workspace-heading"><span className="eyebrow">BSHOP ACCESS REQUEST</span><h1>Describe the job, not the API.</h1><p>BShop converts this request into the smallest enforceable scope supported by its catalog.</p></div>
      <section className="intent-card">
        <div className="agent-identity"><span><TerminalWindow weight="duotone" /></span><div><strong>ProcureKit Agent</strong><small>Unregistered · wallet 7Yq4…sP2a</small></div><span className="identity-status">UNKNOWN</span></div>
        <label className="intent-field">Purpose<textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <div className="request-constraints"><label>Expected calls<input value="25" readOnly /></label><label>Session duration<input value="5 minutes" readOnly /></label><label>Maximum usage<input value="0.20 demo units" readOnly /></label></div>
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
          <dl><div><dt>Usage cap</dt><dd>{usdc(v.usageCapAtomic)} DEMO UNIT</dd></div><div><dt>Refundable bond</dt><dd>{usdc(v.bondAmountAtomic)} DEVNET TOKEN</dd></div><div><dt>Maximum penalty</dt><dd>{usdc(v.maxPenaltyAtomic)} DEVNET TOKEN</dd></div><div><dt>Rate</dt><dd>{policy?.constraints.maxRequestsPerMinute ?? 5}/min</dd></div></dl>
          <div className="money-separation"><div><Wallet /><span><strong>Usage</strong><small>Gateway meter · pay.sh x402 sandbox-verified</small></span></div><div><ShieldCheck /><span><strong>Bond</strong><small>Live Solana devnet escrow · returned by rule</small></span></div></div>
          <p className="safety-copy"><LockKey /> Only deterministic TTL, rate, endpoint, field and cost rules can trigger settlement.</p>
          <button className="primary-action" onClick={onActivate} disabled={live}><Wallet /> {live ? "Waiting for bond confirmation" : `Lock ${usdc(v.bondAmountAtomic)} DEVNET TOKEN & open session`}<ArrowRight /></button>
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
          <dl className="bond-monitor"><div><dt>Bond locked</dt><dd>{usdc(v.bondAmountAtomic)} DEVNET TOKEN</dd></div><div><dt>Usage so far</dt><dd>{usdc(v.usageSpentAtomic)} DEMO UNIT</dd></div><div><dt>Penalty ceiling</dt><dd>{usdc(v.maxPenaltyAtomic)} DEVNET TOKEN</dd></div></dl>
        </aside>
      </div>
    </main>
  );
}

function SettlementReceipt({ v, fixtureMode, onReset }: { v: ViewState; fixtureMode: boolean; onReset: () => void }) {
  const violated = v.penaltyAtomic > 0;
  const blockedWithoutPenalty = !violated && v.deniedCount > 0;
  return (
    <main className="workspace receipt-workspace">
      <div className="receipt-status"><span className={violated ? "warning" : "success"}>{violated ? <WarningCircle weight="duotone" /> : <CheckCircle weight="duotone" />}</span><div><span className="eyebrow">SESSION SETTLED</span><h1>{violated ? "Inventory recovered. Penalty bounded." : blockedWithoutPenalty ? "Private request blocked. Bond returned." : "Task complete. Bond returned."}</h1><p>{violated ? "The reservation expired by an objective TTL rule. The merchant received only the pre-agreed amount." : blockedWithoutPenalty ? "The Gateway stopped the out-of-scope request before origin. A denied read alone does not slash the bond." : "The agent stayed inside scope and released its reservation. Only actual usage was charged."}</p></div></div>
      <section className="receipt-paper">
        <div className="receipt-head"><div><span className="brand-name">BotBond</span><small>Settlement receipt</small></div><span>{v.outcome ?? v.sessionState}</span></div>
        <div className="receipt-money"><div><span>Usage metered</span><strong>{usdc(v.usageSpentAtomic)} <small>DEMO UNIT</small></strong></div><div><span>Penalty settled</span><strong>{usdc(v.penaltyAtomic)} <small>DEVNET TOKEN</small></strong></div><div className="refund"><span>Bond returned</span><strong>{usdc(v.bondRefundedAtomic)} <small>DEVNET TOKEN</small></strong></div></div>
        <div className="receipt-evidence"><div><span>Policy hash</span><code>{shortHash(v.policyHash)}</code></div><div><span>Requests</span><code>{v.callCount} allowed · {v.deniedCount} denied</code></div><div><span>Receipt hash</span><code>{shortHash(v.receiptHash)}</code></div></div>
        <div className="tx-list">
          {v.txs.map((tx) => <div key={tx.signature}><span><CheckCircle weight="fill" /><span><strong>{tx.label}</strong><small>{shortSig(tx.signature)} · {tx.status}</small></span></span>{tx.explorerEligible ? <a href={explorerUrl(tx.signature, tx.cluster)} target="_blank" rel="noreferrer">Explorer <ArrowSquareOut /></a> : <span className="fixture-reference">{fixtureMode ? "FIXTURE REFERENCE" : tx.cluster}</span>}</div>)}
        </div>
      </section>
      <div className="receipt-actions"><button className="secondary-action" onClick={onReset}>Start another session</button><span><ShieldCheck /> Rules enforced without an operator decision</span></div>
    </main>
  );
}

function AgentRunSelector({ scenarioId, onChange, disabled, onRunLive, progress, error }: { scenarioId: string; onChange: (id: string) => void; disabled: boolean; onRunLive: () => void; progress: string | null; error: string | null }) {
  return <div className="agent-run-selector"><div><span className="eyebrow">PUBLIC DEVNET AGENT</span><strong>Choose what the external agent attempts</strong><p>Each live run opens a fresh Solana bond. BShop sponsors the demo wallet and limits public usage.</p></div><div><div className="run-options">
    {SCENARIOS.map((scenario) => <button key={scenario.id} data-active={scenarioId === scenario.id} onClick={() => onChange(scenario.id)} disabled={disabled}><span>{scenario.label}</span><small>{scenario.detail}</small></button>)}
  </div><button className="live-run-action" onClick={onRunLive} disabled={disabled}><Circle weight="fill" /> {progress ?? "Run fresh Solana devnet session"}<ArrowRight /></button><small className="runner-boundary">Sponsored browser runner: live Solana bond · HMAC usage bridge. Use Integrate for the real pay.sh x402 sandbox call.</small>{error && <div className="public-run-error"><WarningCircle /> {error}</div>}</div></div>;
}

function DeveloperIntegration({ onOpenAgent }: { onOpenAgent: () => void }) {
  const [probes, setProbes] = useState<ConnectionProbe[]>([]);
  const [checking, setChecking] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const externalCommand = `npm run example:external-agent -- \\\n+  --gateway https://botbond-gateway-752329931962.us-central1.run.app \\\n+  --wallet ~/.config/solana/id.json`;

  const readProbe = async (label: string, request: string, url: string): Promise<ConnectionProbe> => {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const error = body.error as { code?: string } | undefined;
    const programId = (body.bond as { programId?: string } | undefined)?.programId;
    const detail = programId
      ? `Program ${programId.slice(0, 8)}… published by discovery`
      : error?.code ?? (response.status === 402 ? "x402 payment challenge returned" : "Response received");
    return { label, request, status: response.status, detail, traceId: response.headers.get("x-cloud-trace-context") };
  };

  const runConnectionCheck = async () => {
    if (checking) return;
    setChecking(true);
    setProbes([]);
    try {
      const results = await Promise.all([
        readProbe("Agent discovery", "GET /.well-known/agent-access", "/gateway/.well-known/agent-access"),
        readProbe("Direct product request", "GET /products", "/gateway/products"),
        readProbe("pay.sh payment gate", "GET /v1/access/browser-check/products", "/pay-gate/v1/access/browser-check/products"),
      ]);
      setProbes(results);
    } catch (cause) {
      setProbes([{ label: "Connection check", request: "browser → deployed services", status: 0, detail: cause instanceof Error ? cause.message : "Network error", traceId: null }]);
    } finally {
      setChecking(false);
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(externalCommand);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return <main className="developer-surface">
    <div className="developer-heading"><span className="eyebrow">BRING YOUR AGENT</span><h1>Connect to a published agent lane, not an API-key queue.</h1><p>BShop keeps its normal WAF policy. The merchant explicitly exposes a signed agent lane, and BotBond issues only the scope compiled for that job.</p></div>
    <section className="cloudflare-boundary"><div><strong>Normal web traffic</strong><code>Agent → Cloudflare WAF → existing site policy</code><span>Unknown automation remains blocked.</span></div><ArrowRight /><div><strong>Merchant-approved agent lane</strong><code>Agent → WAF allowlisted path → BotBond → scoped API</code><span>No Cloudflare bypass. The site opens this route deliberately.</span></div></section>
    <section className="connection-checker">
      <div className="connection-checker-head"><div><span className="eyebrow">LIVE CONNECTION CHECK</span><h2>Test BShop’s public integration surface.</h2><p>These are browser requests to deployed Cloud Run services—not fixture events. The final payment is intentionally not made by this browser.</p></div><button className="secondary-action" onClick={runConnectionCheck} disabled={checking}>{checking ? <ClockCountdown /> : <ArrowRight />}{checking ? "Checking deployed services…" : "Run connection check"}</button></div>
      <div className="connection-results" aria-live="polite">
        {probes.length === 0 ? <div className="connection-empty"><Code /> Run the check to see discovery, direct rejection and the x402 payment challenge.</div> : probes.map((probe) => <div className="connection-result" data-status={probe.status} key={probe.label}><div><strong>{probe.label}</strong><code>{probe.request}</code></div><span className="connection-status">{probe.status || "ERR"}</span><p>{probe.detail}</p>{probe.traceId && <small>Cloud trace {probe.traceId.slice(0, 16)}…</small>}</div>)}
      </div>
      {probes.length > 0 && <p className="connection-boundary"><ShieldCheck weight="duotone" /> `402` proves that the hosted pay.sh sandbox gate challenged this request. Payment and a scoped `200` require the external-agent command below; this page never claims to pay on the visitor’s behalf.</p>}
    </section>
    <div className="integration-grid"><section><span className="step-number">01</span><h2>Discover</h2><pre>{`GET /.well-known/agent-access`}</pre><p>Read the catalog, session endpoints, Solana program and devnet onboarding mode.</p></section><section><span className="step-number">02</span><h2>Declare intent</h2><pre>{`POST /v1/intents\n{\n  "task": "Compare price and stock",\n  "agentWallet": "<SOLANA_PUBLIC_KEY>",\n  "budget": { ... }\n}`}</pre><p>Gemini maps the request to BShop’s own endpoint and field catalog.</p></section><section><span className="step-number">03</span><h2>Open the bond</h2><pre>{`npm run example:external-agent -- \\\n  --gateway https://... \\\n  --wallet ~/.config/solana/id.json`}</pre><p>The example creates a devnet test mint, opens the real bond, activates a short session and prints Explorer links.</p></section></div>
    <section className="own-agent-card"><div><span className="eyebrow">OWN-WALLET EXECUTION</span><h2>Run the paid sandbox rail and devnet bond yourself.</h2><p>Your local Solana keypair signs the bond open. The CLI then performs pay.sh sandbox `402 → payment → scoped 200` before the session closes and prints two Explorer links.</p><pre>{externalCommand}</pre></div><div className="own-agent-actions"><button className="primary-action" onClick={copyCommand}><Code />{copyState === "copied" ? "Command copied" : copyState === "failed" ? "Copy unavailable" : "Copy external-agent command"}</button><button className="secondary-action" onClick={onOpenAgent}><TerminalWindow />Try sponsored browser session</button><small>Needs Node 22+, Solana CLI and devnet SOL. Uses a devnet test mint, not USDC.</small></div></section>
    <section className="integration-truth"><ShieldCheck weight="duotone" /><div><strong>Execution boundary</strong><p>The external-agent command pays the hosted BotBond API through the actual pay.sh x402 sandbox gate, then opens and settles a real Solana devnet bond. The sponsored browser runner uses a labelled HMAC usage bridge because the browser does not own the pay.sh CLI wallet.</p></div><a href="https://github.com/Jaemani/BotBond/blob/main/docs/16-bring-your-agent.md" target="_blank" rel="noreferrer">Open setup guide <ArrowSquareOut /></a></section>
  </main>;
}

function MerchantOperations({ v, onOpenAgent }: { v: ViewState; onOpenAgent: () => void }) {
  const stock = v.reservation?.status === "HELD" ? 0 : 1;
  const latest = v.trace.slice(-6).reverse();
  return <main className="operations-surface"><div className="role-ribbon merchant"><ShieldCheck weight="fill" /> MERCHANT OPERATIONS <span>Operator-only view</span></div>
    <div className="ops-heading"><div><span className="eyebrow">BSHOP MERCHANT OPS · POWERED BY BOTBOND</span><h1>Keep the API closed. Keep the right agent lane open.</h1><p>Unknown automation stops before origin; declared, bounded sessions can use only the operations BShop approves.</p></div><button className="secondary-action" onClick={onOpenAgent}>Open Agent Console <ArrowRight /></button></div>
    <section className="ops-kpis"><div><span>NovaBook Air inventory</span><strong>{stock}</strong><small>{stock === 0 ? "Held by an agent" : "Available for checkout"}</small></div><div><span>Session state</span><strong>{v.sessionState}</strong><small>{v.callCount} allowed · {v.deniedCount} denied</small></div><div><span>Bond state</span><strong>{v.bondPhase}</strong><small>{usdc(v.penaltyAtomic)} devnet demo token settled</small></div></section>
    <div className="ops-grid"><section className="access-outcomes"><div className="section-head"><div><ShieldCheck /><strong>How BShop handles automation</strong></div></div>
      <div className="outcome-row"><span className="outcome-icon success"><Check /></span><div><strong>Scoped request</strong><small>Price, stock and reservation calls reach the commerce API.</small></div><b>200</b></div>
      <div className="outcome-row"><span className="outcome-icon denied"><LockKey /></span><div><strong>Unknown or private-data request</strong><small>Blocked before origin; no protected data leaves BShop.</small></div><b>403</b></div>
      <div className="outcome-row"><span className="outcome-icon warning"><ClockCountdown /></span><div><strong>Abandoned reservation</strong><small>Inventory returns after TTL; settlement stays under the signed ceiling.</small></div><b>0.25</b></div>
    </section><section className="ops-feed"><div className="section-head"><div><TerminalWindow /><strong>Current session</strong></div><code>{v.policyHash ? shortHash(v.policyHash) : "No contract yet"}</code></div>
      {latest.length === 0 ? <div className="empty-stream">No agent activity yet. Open the Agent API to send a request.</div> : <div className="ops-events">{latest.map((row) => <div key={row.id}><span data-kind={row.kind}>{row.kind === "DENIED" ? <X /> : <Check />}</span><div><strong>{row.method} {row.path}</strong><small>{row.detail || row.headline}</small></div><time>{new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>)}</div>}
    </section></div>
  </main>;
}

export function BShopExperience({ initialSurface = "overview" }: { initialSurface?: Surface }) {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [live, setLive] = useState<LiveEventStream | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [publicRunProgress, setPublicRunProgress] = useState<string | null>(null);
  const [publicRunError, setPublicRunError] = useState<string | null>(null);
  const [directEvidence, setDirectEvidence] = useState<DirectRequestEvidence | null>(null);
  const [directRequesting, setDirectRequesting] = useState(false);

  useEffect(() => {
    const stream = liveStreamFromLocation();
    const params = new URLSearchParams(window.location.search);
    const requestedScenario = params.get("scenario");
    const scenarioByBehavior: Record<string, string> = {
      normal: "01-normal-session",
      "scope-denied": "02-scope-denied",
      abandon: "03-abandoned-reservation",
    };
    if (requestedScenario && scenarioByBehavior[requestedScenario]) {
      setScenarioId(scenarioByBehavior[requestedScenario]);
    }
    setLive(stream);
    const requestedSurface = params.get("surface");
    if (stream) setSurface("agent");
    else if (requestedSurface === "overview" || requestedSurface === "agent" || requestedSurface === "developer" || requestedSurface === "operations" || requestedSurface === "shop") setSurface(requestedSurface);
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
  const runLive = async () => {
    if (publicRunProgress) return;
    setPublicRunError(null);
    setPublicRunProgress("Opening a sponsored Solana bond…");
    try {
      const run = await createPublicDemoRun(
        BEHAVIOR_BY_SCENARIO[scenarioId] ?? "normal",
        setPublicRunProgress,
      );
      setLive({ url: `/gateway${run.eventStream}`, token: run.token });
      setPublicRunProgress("Bond confirmed · connecting agent…");
      await executePublicDemoRun(run, setPublicRunProgress);
      setPublicRunProgress(null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "PUBLIC_DEMO_FAILED";
      const messages: Record<string, string> = {
        PUBLIC_DEMO_COOLDOWN: "The sponsored runner is temporarily unavailable. Please try again shortly.",
        PUBLIC_DEMO_BUSY: "Another public devnet transaction is confirming. Try again shortly.",
        PUBLIC_DEMO_DAILY_LIMIT: "Today’s sponsored transaction budget has been reached. The external-agent example remains available.",
      };
      setPublicRunError(messages[code] ?? `Live run failed: ${code}`);
      setPublicRunProgress(null);
    }
  };
  const runDirectRequest = async () => {
    if (directRequesting) return;
    setDirectRequesting(true);
    setDirectEvidence(null);
    try {
      const response = await fetch("/gateway/products", { cache: "no-store" });
      const body = await response.json().catch(() => ({ error: { code: "UNPARSEABLE_RESPONSE" } })) as Record<string, unknown>;
      setDirectEvidence({
        status: response.status,
        statusText: response.statusText || (response.status === 403 ? "Forbidden" : response.ok ? "OK" : "Request failed"),
        body,
        traceId: response.headers.get("x-cloud-trace-context"),
      });
    } catch (cause) {
      setDirectEvidence({ status: 0, statusText: "Network error", body: { error: String(cause) }, traceId: null });
    } finally {
      setDirectRequesting(false);
    }
  };
  const navigateSurface = (next: Surface) => {
    setSurface(next);
    const paths: Record<Surface, string> = { overview: "/", shop: "/shop", agent: "/agent", operations: "/merchant", developer: "/integrate" };
    const url = new URL(paths[next], window.location.origin);
    window.history.replaceState({}, "", url);
  };
  const startAnotherSession = () => {
    player.reset();
    setLive(null);
    setPublicRunProgress(null);
    setPublicRunError(null);
    setDirectEvidence(null);
    navigateSurface("agent");
  };

  return (
    <div className="app-shell">
      <CommerceHeader surface={surface} setSurface={navigateSurface} live={Boolean(live)} liveStatus={player.liveStatus} />
      {loadError && <div className="load-error">Could not load demo evidence: {loadError}</div>}
      {surface === "overview" && <BotBondOverview onNavigate={navigateSurface} />}
      {surface === "shop" && <Storefront stock={stock} onAddToCart={() => { setOrderPlaced(false); setCartOpen(true); }} onAgentAccess={() => navigateSurface("agent")} />}
      {surface === "agent" && <div className="agent-surface"><div className="role-ribbon agent"><TerminalWindow weight="fill" /> EXTERNAL AGENT CONSOLE <span>Machine client path</span></div><AgentRunSelector scenarioId={scenarioId} onChange={changeScenario} disabled={Boolean(live) || player.playing || Boolean(publicRunProgress)} onRunLive={runLive} progress={publicRunProgress} error={publicRunError} /><ExecutionTruth live={Boolean(live)} /><RequestBoundary v={v} stage={stage} live={Boolean(live)} directAttempted={Boolean(directEvidence)} />
        {stage === 1 && <AccessDenied onOpenLive={runLive} directEvidence={directEvidence} directRequesting={directRequesting} onDirectRequest={runDirectRequest} live={Boolean(live)} />}
        {stage === 2 && <IntentRequest v={v} onCompile={() => player.seek(positions.policy)} live={Boolean(live)} />}
        {stage === 3 && <AccessContract v={v} onActivate={() => player.seek(positions.active)} live={Boolean(live)} />}
        {stage === 4 && <ActiveSession v={v} onRun={player.play} playing={player.playing} onPause={player.pause} scenarioId={scenarioId} live={Boolean(live)} />}
        {stage === 5 && <SettlementReceipt v={v} fixtureMode={v.fixtureMode} onReset={startAnotherSession} />}
      </div>}
      {surface === "developer" && <DeveloperIntegration onOpenAgent={() => navigateSurface("agent")} />}
      {surface === "operations" && <MerchantOperations v={v} onOpenAgent={() => navigateSurface("agent")} />}
      <CartDrawer open={cartOpen} placed={orderPlaced} onClose={() => setCartOpen(false)} onCheckout={() => setOrderPlaced(true)} />
    </div>
  );
}

export default BShopExperience;
