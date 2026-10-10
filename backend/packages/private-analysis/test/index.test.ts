import { describe, expect, test } from "bun:test";
import { createPrivateAnalysisToolkit, PrivateAnalysisError, type AnalysisRow } from "../src";

const rows: AnalysisRow[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ region: "north", spend: 10 + i })),
  ...Array.from({ length: 4 }, (_, i) => ({ region: "south", spend: 20 + i })),
  ...Array.from({ length: 2 }, (_, i) => ({ region: "west", spend: 30 + i })),
];

function toolkit(data = rows, maximumRows = 100) {
  return createPrivateAnalysisToolkit({
    source: { async *open(datasetId) { expect(datasetId).toBe("orders"); yield* data; } },
    policy: { dimensions: ["region"], measures: ["spend"], minimumCohortSize: 5, maximumRows, maximumGroups: 10 },
  });
}

describe("cloneable private data analysis toolkit", () => {
  test("returns aggregate count/sum/mean, never source rows", async () => {
    const analysis = toolkit();
    await expect(analysis.run({ requestId: "req-1", datasetId: "orders", query: { operation: "count" } }))
      .resolves.toMatchObject({ operation: "count", value: 11 });
    await expect(analysis.run({ requestId: "req-2", datasetId: "orders", query: { operation: "sum", field: "spend" } }))
      .resolves.toMatchObject({ operation: "sum", value: 207, cohortSize: 11 });
    await expect(analysis.run({ requestId: "req-3", datasetId: "orders", query: { operation: "mean", field: "spend" } }))
      .resolves.toMatchObject({ operation: "mean", value: 207 / 11 });
  });

  test("suppresses groups below the minimum cohort size", async () => {
    await expect(toolkit().run({ requestId: "req-4", datasetId: "orders", query: { operation: "group-count", groupBy: "region" } }))
      .resolves.toMatchObject({ groups: [{ key: "north", value: 5, cohortSize: 5 }], suppressedGroups: 2 });
  });

  test("enforces field allowlists, minimum cohort, and row limits", async () => {
    await expect(toolkit().run({ requestId: "req-5", datasetId: "orders", query: { operation: "sum", field: "salary" } }))
      .rejects.toMatchObject({ code: "FIELD_NOT_ALLOWED" });
    await expect(toolkit(rows.slice(0, 4)).run({ requestId: "req-6", datasetId: "orders", query: { operation: "count" } }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_COHORT" });
    await expect(toolkit(rows, 5).run({ requestId: "req-7", datasetId: "orders", query: { operation: "count" } }))
      .rejects.toMatchObject({ code: "ROW_LIMIT" });
  });

  test("rejects non-numeric measure values and invalid group values", async () => {
    await expect(toolkit([{ region: "north", spend: "10" }]).run({ requestId: "req-8", datasetId: "orders", query: { operation: "sum", field: "spend" } }))
      .rejects.toMatchObject({ code: "INVALID_ROW" });
    await expect(toolkit([{ region: null, spend: 10 }, ...rows.slice(1)]).run({ requestId: "req-9", datasetId: "orders", query: { operation: "group-count", groupBy: "region" } }))
      .rejects.toBeInstanceOf(PrivateAnalysisError);
  });

  test("validates request IDs and aborts during source iteration", async () => {
    await expect(toolkit().run({ requestId: "bad id", datasetId: "orders", query: { operation: "count" } }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const controller = new AbortController();
    const aborting = createPrivateAnalysisToolkit({
      source: { async *open() { controller.abort(); yield rows[0]!; } },
      policy: { dimensions: [], measures: [] },
    });
    await expect(aborting.run({ requestId: "req-10", datasetId: "orders", query: { operation: "count" } }, controller.signal))
      .rejects.toMatchObject({ code: "CANCELLED" });
  });
});
