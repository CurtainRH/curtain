import { describe, expect, test } from "bun:test";
import { BoothsError, createBoothsRuntime, type BoothsProvider } from "../src";

const cpuProvider: BoothsProvider<{ prompt: string }, { text: string }> = {
  capabilities: () => ({ provider: "test-cpu", devices: ["cpu"], tasks: ["inference"] }),
  execute: async (workload) => ({ output: { text: `received:${workload.input.prompt}` }, usage: { units: 1 } }),
};

describe("cloneable Booths runtime", () => {
  test("runs in-process through the integrator's provider and returns usage", async () => {
    const booths = createBoothsRuntime({ provider: cpuProvider });
    expect(await booths.capabilities()).toEqual({ provider: "test-cpu", devices: ["cpu"], tasks: ["inference"] });
    const result = await booths.run({ requestId: "test-1", task: "inference", model: "local-model", input: { prompt: "hello" } });
    expect(result).toMatchObject({
      requestId: "test-1", task: "inference", model: "local-model",
      output: { text: "received:hello" }, provider: { provider: "test-cpu" }, usage: { units: 1 },
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("validates size, task support, and request identifiers before dispatch", async () => {
    const booths = createBoothsRuntime({ provider: cpuProvider, maxInputBytes: 20 });
    await expect(booths.run({ requestId: "bad id", task: "inference", model: "m", input: { prompt: "x" } }))
      .rejects.toMatchObject({ code: "INVALID_WORKLOAD" });
    await expect(booths.run({ requestId: "test-2", task: "fine-tune", model: "m", input: { prompt: "x" } }))
      .rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    const enoughRoom = createBoothsRuntime({ provider: cpuProvider });
    await expect(enoughRoom.run({ requestId: "test-3", task: "fine-tune", model: "m", input: { prompt: "x" } }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_TASK" });
  });

  test("bounds output and enforces execution timeouts", async () => {
    const tooLarge: BoothsProvider = {
      capabilities: () => ({ provider: "test", devices: ["cpu"], tasks: ["inference"] }),
      execute: async () => ({ output: { value: "x".repeat(100) } }),
    };
    await expect(createBoothsRuntime({ provider: tooLarge, maxOutputBytes: 20 }).run({
      requestId: "test-4", task: "inference", model: "m", input: {},
    })).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });

    const slow: BoothsProvider = {
      capabilities: () => ({ provider: "test", devices: ["cpu"], tasks: ["inference"] }),
      execute: async () => new Promise((resolve) => setTimeout(() => resolve({ output: {} }), 50)),
    };
    await expect(createBoothsRuntime({ provider: slow, timeoutMs: 1 }).run({
      requestId: "test-5", task: "inference", model: "m", input: {},
    })).rejects.toBeInstanceOf(BoothsError);
    await expect(createBoothsRuntime({ provider: slow, timeoutMs: 1 }).run({
      requestId: "test-6", task: "inference", model: "m", input: {},
    })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
