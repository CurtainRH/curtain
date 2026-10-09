import { describe, expect, test } from "bun:test";
import { createBoothsClient } from "../src/booths";

describe("Booths server SDK", () => {
  test("submits idempotent jobs and retrieves status with bearer auth", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const client = createBoothsClient({
      baseUrl: "https://operator.test/",
      apiKey: "ctn_live_secret",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json(requests.length === 1
          ? { id: "a".repeat(32), task: "demo.echo", status: "queued" }
          : { id: "a".repeat(32), task: "demo.echo", status: "succeeded", output: { value: 3 } });
      },
    });
    const submitted = await client.submit("demo.echo", { value: 3 }, "demo-1");
    expect(submitted.status).toBe("queued");
    expect(requests[0]?.url).toBe("https://operator.test/v1/compute/jobs");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer ctn_live_secret");
    expect(new Headers(requests[0]?.init?.headers).get("idempotency-key")).toBe("demo-1");
    const result = await client.get(submitted.id);
    expect(result).toMatchObject({ status: "succeeded", output: { value: 3 } });
  });
});
