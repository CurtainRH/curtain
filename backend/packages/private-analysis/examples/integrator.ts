import { createPrivateAnalysisToolkit, type AnalysisRow } from "../src";

// Replace this with a source adapter that reads from your own database or data lake.
const sampleRows: AnalysisRow[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ segment: "consumer", spend: 120 + i })),
  ...Array.from({ length: 2 }, (_, i) => ({ segment: "small cohort", spend: 40 + i })),
];

const analysis = createPrivateAnalysisToolkit({
  source: {
    async *open(datasetId, { signal }) {
      if (datasetId !== "monthly-spend") throw new Error("Unknown dataset");
      for (const row of sampleRows) {
        if (signal.aborted) return;
        yield row;
      }
    },
  },
  policy: {
    dimensions: ["segment"],
    measures: ["spend"],
    minimumCohortSize: 5,
  },
});

const result = await analysis.run({
  requestId: crypto.randomUUID(),
  datasetId: "monthly-spend",
  query: { operation: "group-sum", groupBy: "segment", field: "spend" },
});
console.log(result);
