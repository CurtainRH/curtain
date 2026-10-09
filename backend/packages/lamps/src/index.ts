import type { BoothsCapabilities } from "@curtain/booths";

export type ReservationStatus =
  | "reserved"
  | "accepted"
  | "running"
  | "delivered"
  | "disputed"
  | "completed"
  | "refunded";

export interface LampsOffer {
  id: string;
  hostId: string;
  /** Must exactly match one device class advertised by the host's Booths provider. */
  gpuClass: string;
  region: string;
  /** Canonical ISO-8601 UTC timestamps, e.g. 2026-11-01T12:00:00.000Z. */
  startsAt: string;
  endsAt: string;
  /** Number of equivalent GPUs offered in this same fixed time window. */
  capacity: number;
  /** Abstract payment denomination for now; Lamps v0 does not custody or transfer funds. */
  priceAsset: string;
  priceAmount: string;
  tasks: string[];
}

export interface LampsUsageReceipt {
  boothsRequestId: string;
  startedAt: string;
  finishedAt: string;
  /** SHA-256 of a canonicalized result/usage statement, not proof of correct execution. */
  resultHash: string;
  usageSeconds: number;
}

export interface LampsReservation {
  id: string;
  offerId: string;
  buyerId: string;
  hostId: string;
  status: ReservationStatus;
  createdAt: string;
  acceptedAt?: string;
  startedAt?: string;
  deliveredAt?: string;
  receipt?: LampsUsageReceipt;
  disputeReason?: string;
}

export class LampsError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "LampsError";
  }
}

export interface LampsBookOptions {
  now?: () => number;
  confirmWindowSeconds?: number;
}

/**
 * Cloneable in-process Lamps booking protocol. It models reservations and delivery lifecycle only;
 * it is not persistent, does not custody funds, and does not cryptographically verify receipts.
 */
export function createLampsBook(options: LampsBookOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const confirmWindowSeconds = options.confirmWindowSeconds ?? 24 * 60 * 60;
  const offers = new Map<string, LampsOffer>();
  const reservations = new Map<string, LampsReservation>();
  const requestIds = new Map<string, string>();

  function publish(offer: LampsOffer, capabilities: BoothsCapabilities): LampsOffer {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(offer.id) || !/^[A-Za-z0-9_.:-]{1,96}$/.test(offer.hostId))
      throw new LampsError("Offer and host IDs must be 1–96 safe characters", "INVALID_ID");
    if (!offer.gpuClass.trim() || offer.gpuClass.length > 120 || !offer.region.trim() || offer.region.length > 80)
      throw new LampsError("A GPU class and region are required", "INVALID_OFFER");
    const start = parseUtc(offer.startsAt, "startsAt");
    const end = parseUtc(offer.endsAt, "endsAt");
    if (start <= now() || end <= start || (end - start) % 3_600_000 !== 0)
      throw new LampsError("Offer must describe a future, positive, whole-hour UTC window", "INVALID_WINDOW");
    if (!Number.isSafeInteger(offer.capacity) || offer.capacity < 1 || offer.capacity > 1024)
      throw new LampsError("capacity must be an integer from 1 to 1024 GPUs", "INVALID_OFFER");
    if (!/^[1-9]\d{0,77}$/.test(offer.priceAmount) || BigInt(offer.priceAmount) >= 2n ** 256n)
      throw new LampsError("priceAmount must be a positive uint256 decimal string", "INVALID_PRICE");
    if (!offer.priceAsset.trim() || offer.priceAsset.length > 96)
      throw new LampsError("priceAsset is required", "INVALID_PRICE");
    if (!Array.isArray(offer.tasks) || offer.tasks.length === 0 || new Set(offer.tasks).size !== offer.tasks.length)
      throw new LampsError("Offer must list unique supported tasks", "INVALID_OFFER");
    if (!capabilities.devices.includes(offer.gpuClass))
      throw new LampsError("The host Booths provider does not advertise this GPU class", "PROVIDER_MISMATCH");
    if (capabilities.devices.filter((device) => device === offer.gpuClass).length < offer.capacity)
      throw new LampsError("Offer capacity exceeds the matching Booths devices advertised by the host", "PROVIDER_MISMATCH");
    if (offer.tasks.some((task) => !capabilities.tasks.includes("*") && !capabilities.tasks.includes(task)))
      throw new LampsError("The host Booths provider does not support every offered task", "PROVIDER_MISMATCH");
    if (offers.has(offer.id)) throw new LampsError("Offer ID already exists", "DUPLICATE_OFFER");
    const stored = structuredClone(offer);
    offers.set(stored.id, stored);
    return structuredClone(stored);
  }

  function reserve(offerId: string, buyerId: string, requestId: string): LampsReservation {
    const offer = offers.get(offerId);
    if (!offer) throw new LampsError("Offer not found", "OFFER_NOT_FOUND");
    if (!buyerId.trim() || buyerId.length > 128 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId))
      throw new LampsError("buyerId and a safe requestId are required", "INVALID_RESERVATION");
    const idempotencyKey = `${buyerId}:${requestId}`;
    const priorId = requestIds.get(idempotencyKey);
    if (priorId) {
      const prior = reservations.get(priorId)!;
      if (prior.offerId !== offerId) throw new LampsError("requestId was already used for another offer", "IDEMPOTENCY_CONFLICT");
      return structuredClone(prior);
    }
    if (now() >= Date.parse(offer.startsAt)) throw new LampsError("This service window has started", "WINDOW_STARTED");
    const used = [...reservations.values()].filter((r) => r.offerId === offerId && r.status !== "refunded").length;
    if (used >= offer.capacity) throw new LampsError("No capacity remains in this service window", "SOLD_OUT");
    const reservation: LampsReservation = {
      id: crypto.randomUUID(), offerId, buyerId, hostId: offer.hostId,
      status: "reserved", createdAt: new Date(now()).toISOString(),
    };
    reservations.set(reservation.id, reservation);
    requestIds.set(idempotencyKey, reservation.id);
    return structuredClone(reservation);
  }

  function accept(id: string, actor: string): LampsReservation {
    const reservation = owned(id, actor, "hostId");
    const offer = offers.get(reservation.offerId)!;
    if (reservation.status !== "reserved" || now() >= Date.parse(offer.startsAt))
      throw new LampsError("Only a pending reservation can be accepted before its window", "INVALID_TRANSITION");
    reservation.status = "accepted";
    reservation.acceptedAt = new Date(now()).toISOString();
    return structuredClone(reservation);
  }

  function start(id: string, actor: string, boothsRequestId: string): LampsReservation {
    const reservation = owned(id, actor, "hostId");
    const offer = offers.get(reservation.offerId)!;
    const current = now();
    if (reservation.status !== "accepted" || current < Date.parse(offer.startsAt) || current >= Date.parse(offer.endsAt))
      throw new LampsError("Reservation must be accepted and started inside its service window", "INVALID_TRANSITION");
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(boothsRequestId))
      throw new LampsError("A Booths request ID is required", "INVALID_RECEIPT");
    reservation.status = "running";
    reservation.startedAt = new Date(current).toISOString();
    reservation.receipt = { boothsRequestId, startedAt: reservation.startedAt, finishedAt: "", resultHash: "", usageSeconds: 0 };
    return structuredClone(reservation);
  }

  function deliver(id: string, actor: string, receipt: LampsUsageReceipt): LampsReservation {
    const reservation = owned(id, actor, "hostId");
    const offer = offers.get(reservation.offerId)!;
    const start = parseUtc(receipt.startedAt, "receipt.startedAt");
    const finish = parseUtc(receipt.finishedAt, "receipt.finishedAt");
    if (reservation.status !== "running" || !reservation.startedAt ||
        receipt.boothsRequestId !== reservation.receipt?.boothsRequestId ||
        start !== Date.parse(reservation.startedAt) || finish < start || finish > Date.parse(offer.endsAt) ||
        !/^0x[\da-f]{64}$/i.test(receipt.resultHash) ||
        !Number.isSafeInteger(receipt.usageSeconds) || receipt.usageSeconds <= 0 || receipt.usageSeconds > (finish - start) / 1000) {
      throw new LampsError("Delivery receipt does not match this active window and Booths job", "INVALID_RECEIPT");
    }
    reservation.status = "delivered";
    reservation.deliveredAt = new Date(now()).toISOString();
    reservation.receipt = structuredClone(receipt);
    return structuredClone(reservation);
  }

  function confirm(id: string, actor: string): LampsReservation {
    const reservation = owned(id, actor, "buyerId");
    if (reservation.status !== "delivered" || !reservation.deliveredAt ||
        now() > Date.parse(reservation.deliveredAt) + confirmWindowSeconds * 1000)
      throw new LampsError("Only a delivered reservation can be confirmed within its review window", "INVALID_TRANSITION");
    reservation.status = "completed";
    return structuredClone(reservation);
  }

  function dispute(id: string, actor: string, reason: string): LampsReservation {
    const reservation = owned(id, actor, "buyerId");
    if (reservation.status !== "delivered" || !reservation.deliveredAt ||
        now() > Date.parse(reservation.deliveredAt) + confirmWindowSeconds * 1000)
      throw new LampsError("Only a delivered reservation can be disputed within its review window", "INVALID_TRANSITION");
    if (!reason.trim() || reason.length > 1000) throw new LampsError("Dispute reason must be 1–1000 characters", "INVALID_DISPUTE");
    reservation.status = "disputed";
    reservation.disputeReason = reason;
    return structuredClone(reservation);
  }

  function refundNoShow(id: string, actor: string): LampsReservation {
    const reservation = owned(id, actor, "buyerId");
    const offer = offers.get(reservation.offerId)!;
    if (["running", "delivered", "disputed", "completed", "refunded"].includes(reservation.status) || now() < Date.parse(offer.endsAt))
      throw new LampsError("No-show refunds are available only after the window when work never started", "INVALID_TRANSITION");
    reservation.status = "refunded";
    return structuredClone(reservation);
  }

  function getReservation(id: string): LampsReservation | undefined {
    const reservation = reservations.get(id);
    return reservation ? structuredClone(reservation) : undefined;
  }

  function getOffer(id: string): LampsOffer | undefined {
    const offer = offers.get(id);
    return offer ? structuredClone(offer) : undefined;
  }

  function availability(id: string): number {
    const offer = offers.get(id);
    if (!offer) throw new LampsError("Offer not found", "OFFER_NOT_FOUND");
    if (now() >= Date.parse(offer.startsAt)) return 0;
    const used = [...reservations.values()].filter((r) => r.offerId === id && r.status !== "refunded").length;
    return Math.max(0, offer.capacity - used);
  }

  function owned(id: string, actor: string, field: "hostId" | "buyerId"): LampsReservation {
    const reservation = reservations.get(id);
    if (!reservation) throw new LampsError("Reservation not found", "RESERVATION_NOT_FOUND");
    if (reservation[field] !== actor) throw new LampsError("Actor is not authorized for this reservation", "UNAUTHORIZED");
    return reservation;
  }

  return { publish, reserve, accept, start, deliver, confirm, dispute, refundNoShow, getReservation, getOffer, availability };
}

function parseUtc(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value)
    throw new LampsError(`${field} must be a canonical ISO UTC timestamp`, "INVALID_WINDOW");
  return parsed;
}
