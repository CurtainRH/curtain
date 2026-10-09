import type { Db } from "@curtain/db";
import { LampsError, type LampsOffer, type LampsReservation, type LampsStore } from "./index";

/** Create the Lamps tables in the integrator's own database before using this adapter. */
export function postgresLampsStore(db: Db): LampsStore {
  return {
    async putOffer(offer) {
      await db.query("INSERT INTO lamps_offers (id, payload) VALUES ($1, $2::jsonb)", [offer.id, JSON.stringify(offer)]);
    },
    async getOffer(id) {
      const rows = await db.query<{ payload: LampsOffer }>("SELECT payload FROM lamps_offers WHERE id = $1", [id]);
      return rows[0]?.payload;
    },
    async reserve({ reservation, requestId, capacity }) {
      return db.transaction(async (tx) => {
        // Lock the offer row to serialize reservations competing for this fixed service window.
        const offer = await tx.query("SELECT id FROM lamps_offers WHERE id = $1 FOR UPDATE", [reservation.offerId]);
        if (!offer.length) throw new LampsError("Offer not found", "OFFER_NOT_FOUND");
        const prior = await tx.query<{ offer_id: string; payload: LampsReservation }>(
          "SELECT offer_id, payload FROM lamps_reservations WHERE buyer_id = $1 AND request_id = $2",
          [reservation.buyerId, requestId],
        );
        if (prior[0]) {
          if (prior[0].offer_id !== reservation.offerId)
            throw new LampsError("requestId was already used for another offer", "IDEMPOTENCY_CONFLICT");
          return prior[0].payload;
        }
        const count = await tx.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM lamps_reservations WHERE offer_id = $1 AND status <> 'refunded'",
          [reservation.offerId],
        );
        if (Number(count[0]?.count ?? 0) >= capacity)
          throw new LampsError("No capacity remains in this service window", "SOLD_OUT");
        await tx.query(
          `INSERT INTO lamps_reservations (id, offer_id, buyer_id, host_id, request_id, status, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [reservation.id, reservation.offerId, reservation.buyerId, reservation.hostId, requestId, reservation.status, JSON.stringify(reservation)],
        );
        return reservation;
      });
    },
    async getReservation(id) {
      const rows = await db.query<{ payload: LampsReservation }>("SELECT payload FROM lamps_reservations WHERE id = $1", [id]);
      return rows[0]?.payload;
    },
    async updateReservation(reservation) {
      const rows = await db.query(
        "UPDATE lamps_reservations SET status = $2, payload = $3::jsonb WHERE id = $1 RETURNING id",
        [reservation.id, reservation.status, JSON.stringify(reservation)],
      );
      if (!rows.length) throw new LampsError("Reservation not found", "RESERVATION_NOT_FOUND");
    },
  };
}
