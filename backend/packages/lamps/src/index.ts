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

/** A receipt is authenticated by the identity configured by the integrator for this host. */
export interface SignedLampsReceipt {
  reservationId: string;
  hostId: string;
  receipt: LampsUsageReceipt;
  signature: `0x${string}`;
}

/** Integrators provide durable storage; this toolkit never assumes a Curtain-operated database. */
export interface LampsStore {
  putOffer(offer: LampsOffer): Promise<void>;
  getOffer(id: string): Promise<LampsOffer | undefined>;
  reserve(input: { reservation: LampsReservation; requestId: string; capacity: number }): Promise<LampsReservation>;
  getReservation(id: string): Promise<LampsReservation | undefined>;
  updateReservation(reservation: LampsReservation): Promise<void>;
}

/** Verify the host's signature with the identity system chosen by the integrator. */
export interface LampsReceiptVerifier {
  verify(input: SignedLampsReceipt): Promise<boolean>;
}

/** Payment/escrow is an adapter boundary: deployments choose their chain, asset and custody code. */
export interface LampsEscrow {
  fundBuyer(input: { reservationId: string; buyerId: string; asset: string; amount: string }): Promise<void>;
  postHostBond(input: { reservationId: string; hostId: string; asset: string; amount: string }): Promise<void>;
  release(reservationId: string): Promise<void>;
  refundNoShow(reservationId: string): Promise<void>;
  openDispute(input: { reservationId: string; buyerId: string; stake: string }): Promise<void>;
  resolveByMutualAgreement(input: {
    reservationId: string;
    buyerId: string;
    hostId: string;
    buyerSignature: `0x${string}`;
    hostSignature: `0x${string}`;
    buyerRefundAmount: string;
    buyerStakeRefundAmount: string;
    hostBondToBuyerAmount: string;
  }): Promise<void>;
}

/** No fixed economics: the integrator chooses basis points and the stake asset through config. */
export interface LampsStakePolicy {
  buyerDisputeStakeBps: number;
  hostBondBps: number;
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
  receiptSignature?: `0x${string}`;
  disputeReason?: string;
  disputeResolution?: {
    buyerRefundAmount: string;
    buyerStakeRefundAmount: string;
    hostBondToBuyerAmount: string;
    buyerSignature: `0x${string}`;
    hostSignature: `0x${string}`;
  };
  paymentStatus?: "unfunded" | "buyer_funded" | "funded" | "released" | "refunded" | "disputed";
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

/**
 * Durable, payment-aware orchestration. The caller supplies storage, identity verification, and
 * escrow integrations. Every value crossing those boundaries is explicit; this toolkit neither
 * hosts a marketplace nor selects an asset, chain, database, or custodian.
 */
export function createLampsToolkit(options: {
  store: LampsStore;
  receipts: LampsReceiptVerifier;
  escrow: LampsEscrow;
  stakePolicy: LampsStakePolicy;
  reviewWindowSeconds?: number;
  now?: () => number;
}) {
  const now = options.now ?? (() => Date.now());
  const bps = (value: number, label: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 10_000)
      throw new LampsError(`${label} must be between 0 and 10000 basis points`, "INVALID_STAKE_POLICY");
  };
  bps(options.stakePolicy.buyerDisputeStakeBps, "buyerDisputeStakeBps");
  bps(options.stakePolicy.hostBondBps, "hostBondBps");
  const reviewWindowSeconds = options.reviewWindowSeconds ?? 24 * 60 * 60;
  if (!Number.isSafeInteger(reviewWindowSeconds) || reviewWindowSeconds < 1)
    throw new LampsError("reviewWindowSeconds must be a positive safe integer", "INVALID_REVIEW_WINDOW");

  async function publish(offer: LampsOffer, capabilities: BoothsCapabilities): Promise<LampsOffer> {
    validateOffer(offer, capabilities, now());
    if (await options.store.getOffer(offer.id)) throw new LampsError("Offer ID already exists", "DUPLICATE_OFFER");
    await options.store.putOffer(structuredClone(offer));
    return structuredClone(offer);
  }

  async function reserve(offerId: string, buyerId: string, requestId: string): Promise<LampsReservation> {
    const offer = await options.store.getOffer(offerId);
    if (!offer) throw new LampsError("Offer not found", "OFFER_NOT_FOUND");
    if (!buyerId.trim() || buyerId.length > 128 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId))
      throw new LampsError("buyerId and a safe requestId are required", "INVALID_RESERVATION");
    if (now() >= Date.parse(offer.startsAt)) throw new LampsError("This service window has started", "WINDOW_STARTED");
    const reservation: LampsReservation = {
      id: crypto.randomUUID(), offerId, buyerId, hostId: offer.hostId,
      status: "reserved", createdAt: new Date(now()).toISOString(), paymentStatus: "unfunded",
    };
    // Store implementation must lock capacity and enforce (buyerId, requestId) atomically.
    return options.store.reserve({ reservation, requestId, capacity: offer.capacity });
  }

  async function fund(id: string, buyerId: string): Promise<LampsReservation> {
    const reservation = await owned(id, buyerId, "buyerId");
    const offer = await getOfferOrThrow(reservation.offerId);
    if (reservation.status !== "reserved" || reservation.paymentStatus !== "unfunded")
      throw new LampsError("Only an unfunded reservation can be funded", "INVALID_TRANSITION");
    await options.escrow.fundBuyer({ reservationId: id, buyerId, asset: offer.priceAsset, amount: offer.priceAmount });
    reservation.paymentStatus = "buyer_funded";
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function postHostBond(id: string, hostId: string): Promise<LampsReservation> {
    const reservation = await owned(id, hostId, "hostId");
    const offer = await getOfferOrThrow(reservation.offerId);
    if (reservation.status !== "reserved" || reservation.paymentStatus !== "buyer_funded")
      throw new LampsError("Buyer payment must be escrowed before the host posts its bond", "INVALID_TRANSITION");
    const amount = ((BigInt(offer.priceAmount) * BigInt(options.stakePolicy.hostBondBps)) / 10_000n).toString();
    if (amount !== "0") await options.escrow.postHostBond({ reservationId: id, hostId, asset: offer.priceAsset, amount });
    reservation.paymentStatus = "funded";
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function deliverSigned(input: SignedLampsReceipt): Promise<LampsReservation> {
    const reservation = await owned(input.reservationId, input.hostId, "hostId");
    const offer = await getOfferOrThrow(reservation.offerId);
    validateReceipt(reservation, offer, input.receipt);
    if (!(await options.receipts.verify(input))) throw new LampsError("Host receipt signature is invalid", "INVALID_SIGNATURE");
    reservation.status = "delivered";
    reservation.deliveredAt = new Date(now()).toISOString();
    reservation.receipt = structuredClone(input.receipt);
    reservation.receiptSignature = input.signature;
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function accept(id: string, hostId: string): Promise<LampsReservation> {
    const reservation = await owned(id, hostId, "hostId");
    const offer = await getOfferOrThrow(reservation.offerId);
    const hasFunds = reservation.paymentStatus === "funded" ||
      (reservation.paymentStatus === "buyer_funded" && options.stakePolicy.hostBondBps === 0);
    if (reservation.status !== "reserved" || !hasFunds || now() >= Date.parse(offer.startsAt))
      throw new LampsError("Only a funded pending reservation can be accepted before its window", "INVALID_TRANSITION");
    reservation.status = "accepted";
    reservation.acceptedAt = new Date(now()).toISOString();
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function start(id: string, hostId: string, boothsRequestId: string): Promise<LampsReservation> {
    const reservation = await owned(id, hostId, "hostId");
    const offer = await getOfferOrThrow(reservation.offerId);
    const current = now();
    if (reservation.status !== "accepted" || current < Date.parse(offer.startsAt) || current >= Date.parse(offer.endsAt))
      throw new LampsError("Reservation must be accepted and started inside its service window", "INVALID_TRANSITION");
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(boothsRequestId)) throw new LampsError("A Booths request ID is required", "INVALID_RECEIPT");
    reservation.status = "running";
    reservation.startedAt = new Date(current).toISOString();
    reservation.receipt = { boothsRequestId, startedAt: reservation.startedAt, finishedAt: "", resultHash: "", usageSeconds: 0 };
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function confirm(id: string, buyerId: string): Promise<LampsReservation> {
    const reservation = await owned(id, buyerId, "buyerId");
    if (reservation.status !== "delivered" || reservation.paymentStatus !== "funded" || !reservation.deliveredAt ||
        now() > Date.parse(reservation.deliveredAt) + reviewWindowSeconds * 1000)
      throw new LampsError("Only a funded, delivered reservation can be confirmed", "INVALID_TRANSITION");
    await options.escrow.release(id);
    reservation.status = "completed";
    reservation.paymentStatus = "released";
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function dispute(id: string, buyerId: string, reason: string): Promise<LampsReservation> {
    const reservation = await owned(id, buyerId, "buyerId");
    if (reservation.status !== "delivered" || reservation.paymentStatus !== "funded" || !reservation.deliveredAt ||
        now() > Date.parse(reservation.deliveredAt) + reviewWindowSeconds * 1000)
      throw new LampsError("Only a funded, delivered reservation can be disputed", "INVALID_TRANSITION");
    if (!reason.trim() || reason.length > 1000) throw new LampsError("Dispute reason must be 1–1000 characters", "INVALID_DISPUTE");
    const offer = await getOfferOrThrow(reservation.offerId);
    const stake = ((BigInt(offer.priceAmount) * BigInt(options.stakePolicy.buyerDisputeStakeBps)) / 10_000n).toString();
    await options.escrow.openDispute({ reservationId: id, buyerId, stake });
    reservation.status = "disputed";
    reservation.paymentStatus = "disputed";
    reservation.disputeReason = reason;
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function resolveDispute(input: {
    reservationId: string; buyerSignature: `0x${string}`; hostSignature: `0x${string}`;
    buyerRefundAmount: string; buyerStakeRefundAmount: string; hostBondToBuyerAmount: string;
  }): Promise<LampsReservation> {
    const reservation = await getReservationOrThrow(input.reservationId);
    if (reservation.status !== "disputed") throw new LampsError("Reservation is not disputed", "INVALID_TRANSITION");
    // Escrow adapter must verify both parties' signatures over the exact resolution terms.
    const { reservationId: _reservationId, ...terms } = input;
    await options.escrow.resolveByMutualAgreement({
      reservationId: reservation.id, buyerId: reservation.buyerId, hostId: reservation.hostId,
      ...terms,
    });
    reservation.disputeResolution = {
      buyerRefundAmount: input.buyerRefundAmount,
      buyerStakeRefundAmount: input.buyerStakeRefundAmount,
      hostBondToBuyerAmount: input.hostBondToBuyerAmount,
      buyerSignature: input.buyerSignature,
      hostSignature: input.hostSignature,
    };
    reservation.status = "completed";
    reservation.paymentStatus = "released";
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function refundNoShow(id: string, buyerId: string): Promise<LampsReservation> {
    const reservation = await owned(id, buyerId, "buyerId");
    const offer = await getOfferOrThrow(reservation.offerId);
    if (reservation.status === "running" || reservation.status === "delivered" || reservation.status === "disputed" ||
        reservation.status === "completed" || reservation.status === "refunded" || now() < Date.parse(offer.endsAt))
      throw new LampsError("No-show refunds are available only after the window when work never started", "INVALID_TRANSITION");
    if (reservation.paymentStatus !== "funded") throw new LampsError("Reservation has no escrowed payment", "NOT_FUNDED");
    await options.escrow.refundNoShow(id);
    reservation.status = "refunded";
    reservation.paymentStatus = "refunded";
    await options.store.updateReservation(reservation);
    return reservation;
  }

  async function getReservationOrThrow(id: string): Promise<LampsReservation> {
    const value = await options.store.getReservation(id);
    if (!value) throw new LampsError("Reservation not found", "RESERVATION_NOT_FOUND");
    return value;
  }
  async function getOfferOrThrow(id: string): Promise<LampsOffer> {
    const value = await options.store.getOffer(id);
    if (!value) throw new LampsError("Offer not found", "OFFER_NOT_FOUND");
    return value;
  }
  async function owned(id: string, actor: string, field: "hostId" | "buyerId"): Promise<LampsReservation> {
    const value = await getReservationOrThrow(id);
    if (value[field] !== actor) throw new LampsError("Actor is not authorized for this reservation", "UNAUTHORIZED");
    return value;
  }

  return { publish, reserve, fund, postHostBond, accept, start, deliverSigned, confirm, dispute, resolveDispute, refundNoShow,
    getReservation: options.store.getReservation.bind(options.store) };
}

function validateOffer(offer: LampsOffer, capabilities: BoothsCapabilities, currentTime: number): void {
  if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(offer.id) || !/^[A-Za-z0-9_.:-]{1,96}$/.test(offer.hostId))
    throw new LampsError("Offer and host IDs must be 1–96 safe characters", "INVALID_ID");
  if (!offer.gpuClass.trim() || offer.gpuClass.length > 120 || !offer.region.trim() || offer.region.length > 80)
    throw new LampsError("A GPU class and region are required", "INVALID_OFFER");
  const start = parseUtc(offer.startsAt, "startsAt");
  const end = parseUtc(offer.endsAt, "endsAt");
  if (start <= currentTime || end <= start || (end - start) % 3_600_000 !== 0)
    throw new LampsError("Offer must describe a future, positive, whole-hour UTC window", "INVALID_WINDOW");
  if (!Number.isSafeInteger(offer.capacity) || offer.capacity < 1 || offer.capacity > 1024)
    throw new LampsError("capacity must be an integer from 1 to 1024 GPUs", "INVALID_OFFER");
  if (!/^[1-9]\d{0,77}$/.test(offer.priceAmount) || BigInt(offer.priceAmount) >= 2n ** 256n)
    throw new LampsError("priceAmount must be a positive uint256 decimal string", "INVALID_PRICE");
  if (!offer.priceAsset.trim() || offer.priceAsset.length > 96) throw new LampsError("priceAsset is required", "INVALID_PRICE");
  if (!Array.isArray(offer.tasks) || offer.tasks.length === 0 || new Set(offer.tasks).size !== offer.tasks.length)
    throw new LampsError("Offer must list unique supported tasks", "INVALID_OFFER");
  if (!capabilities.devices.includes(offer.gpuClass) || capabilities.devices.filter((d) => d === offer.gpuClass).length < offer.capacity)
    throw new LampsError("Offer capacity/class exceeds the host Booths provider", "PROVIDER_MISMATCH");
  if (offer.tasks.some((task) => !capabilities.tasks.includes("*") && !capabilities.tasks.includes(task)))
    throw new LampsError("The host Booths provider does not support every offered task", "PROVIDER_MISMATCH");
}

function validateReceipt(reservation: LampsReservation, offer: LampsOffer, receipt: LampsUsageReceipt): void {
  const start = parseUtc(receipt.startedAt, "receipt.startedAt");
  const finish = parseUtc(receipt.finishedAt, "receipt.finishedAt");
  if (reservation.status !== "running" || !reservation.startedAt || receipt.boothsRequestId !== reservation.receipt?.boothsRequestId ||
      start !== Date.parse(reservation.startedAt) || finish < start || finish > Date.parse(offer.endsAt) ||
      !/^0x[\da-f]{64}$/i.test(receipt.resultHash) || !Number.isSafeInteger(receipt.usageSeconds) ||
      receipt.usageSeconds <= 0 || receipt.usageSeconds > (finish - start) / 1000)
    throw new LampsError("Delivery receipt does not match this active window and Booths job", "INVALID_RECEIPT");
}

function parseUtc(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value)
    throw new LampsError(`${field} must be a canonical ISO UTC timestamp`, "INVALID_WINDOW");
  return parsed;
}
