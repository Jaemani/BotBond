import type { ReservationState } from "@botbond/contracts";
import type { Clock } from "./clock.js";
import type { Repository, ReservationRecord } from "./repository.js";

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  shipping: string;
}

export class CommerceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export class DemoCommerceApi {
  public sellerContactHandlerCalls = 0;
  private readonly products = new Map<string, Product>([
    ["lap-1", { id: "lap-1", name: "OrbitBook 14", price: 1199000, stock: 2, shipping: "2 days" }],
    ["lap-2", { id: "lap-2", name: "NovaBook Air", price: 1399000, stock: 1, shipping: "next day" }],
  ]);
  constructor(private readonly repository: Repository, private readonly clock: Clock) {}

  private getProductDefinition(productId: string): Product {
    const product = this.products.get(productId);
    if (!product) throw new CommerceError("PRODUCT_NOT_FOUND", productId);
    return product;
  }

  async initialize(): Promise<void> {
    for (const product of this.products.values()) {
      await this.repository.putInventoryIfAbsent({ productId: product.id, stock: product.stock, updatedAt: this.clock.now().toISOString() });
    }
  }

  async searchProducts(): Promise<Product[]> {
    return await Promise.all([...this.products.values()].map(async (product) => {
      const inventory = await this.repository.getInventory(product.id);
      return { ...product, stock: inventory?.stock ?? product.stock };
    }));
  }
  async getProduct(productId: string): Promise<Product> {
    const product = this.getProductDefinition(productId);
    const inventory = await this.repository.getInventory(productId);
    return { ...product, stock: inventory?.stock ?? product.stock };
  }
  async getInventory(productId: string): Promise<{ stock: number; updatedAt: string }> {
    const persistent = await this.repository.getInventory(productId);
    if (persistent) return { stock: persistent.stock, updatedAt: persistent.updatedAt };
    const product = this.getProductDefinition(productId);
    return { stock: product.stock, updatedAt: this.clock.now().toISOString() };
  }
  getSellerContacts(): never {
    this.sellerContactHandlerCalls += 1;
    throw new CommerceError("FORBIDDEN_HANDLER_REACHED", "Gateway must prevent this call");
  }

  async createReservation(sessionId: string, productId: string, quantity: number, ttlSeconds: number): Promise<ReservationRecord> {
    const active = (await this.repository.listReservations(sessionId)).filter((record) => record.state === "ACTIVE");
    if (active.length >= 1) throw new CommerceError("MAX_ACTIVE_RESERVATIONS", "Only one active reservation allowed");
    if (quantity !== 1) throw new CommerceError("INVALID_QUANTITY", "Demo reservation quantity must be one");
    const product = this.products.get(productId);
    if (!product || product.stock < quantity) throw new CommerceError("OUT_OF_STOCK", productId);
    const now = this.clock.now();
    const reservation: ReservationRecord = {
      reservationId: `res_${sessionId}_${productId}`,
      sessionId,
      productId,
      quantity,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      state: "ACTIVE",
      settlementRequested: false,
    };
    await this.repository.createReservationWithInventory(reservation);
    return reservation;
  }

  async prepareExpiration(sessionId: string, reservationId: string): Promise<ReservationRecord> {
    const reservation = await this.repository.getReservation(reservationId);
    if (!reservation) throw new CommerceError("RESERVATION_NOT_FOUND", reservationId);
    if (reservation.sessionId !== sessionId) throw new CommerceError("RESERVATION_SESSION_MISMATCH", reservationId);
    if (reservation.state === "ACTIVE" && this.clock.now().getTime() < new Date(reservation.expiresAt).getTime()) {
      throw new CommerceError("RESERVATION_NOT_EXPIRED", reservationId);
    }
    return reservation;
  }

  async finalizeReservation(sessionId: string, reservationId: string, state: Exclude<ReservationState, "ACTIVE">): Promise<{ reservation: ReservationRecord; changed: boolean }> {
    let result: { reservation: ReservationRecord; changed: boolean };
    try {
      result = await this.repository.finalizeReservationWithInventory(sessionId, reservationId, state, this.clock.now().getTime());
    } catch (cause) {
      if (cause instanceof Error) throw new CommerceError(cause.message, reservationId);
      throw cause;
    }
    return result;
  }
}
