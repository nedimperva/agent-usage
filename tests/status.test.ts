import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderStatus } from "../src/lib/status";

describe("fetchProviderStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Zed Instatus UP to operational", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            page: { status: "UP" },
            activeIncidents: [],
            activeMaintenances: [],
          }),
          { status: 200 },
        ),
      ),
    );

    const snapshot = await fetchProviderStatus("zed");

    expect(snapshot?.level).toBe("operational");
    expect(snapshot?.indicator).toBe("up");
  });

  it("maps minor Zed incidents to degraded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            page: { status: "HASISSUES" },
            activeIncidents: [{ name: "Agent latency", status: "INVESTIGATING", impact: "MINOR" }],
          }),
          { status: 200 },
        ),
      ),
    );

    const snapshot = await fetchProviderStatus("zed");

    expect(snapshot?.level).toBe("degraded");
    expect(snapshot?.summary).toContain("Agent latency");
  });

  it("maps major Zed incidents to outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            page: { status: "HASISSUES" },
            activeIncidents: [{ name: "API unavailable", status: "IDENTIFIED", impact: "MAJOROUTAGE" }],
          }),
          { status: 200 },
        ),
      ),
    );

    const snapshot = await fetchProviderStatus("zed");

    expect(snapshot?.level).toBe("outage");
  });

  it("returns unknown for malformed Zed payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ foo: "bar" }), { status: 200 })));

    const snapshot = await fetchProviderStatus("zed");

    expect(snapshot?.level).toBe("unknown");
    expect(snapshot?.summary).toBe("Unknown service state");
  });

  it("returns unknown when the status request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")));

    const snapshot = await fetchProviderStatus("zed");

    expect(snapshot?.level).toBe("unknown");
    expect(snapshot?.summary).toBe("Status check failed");
  });
});
