import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/worker.js";
import { getResolvedConfig } from "../src/config.js";
import { createHonchoHarness, installFetchMock } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// Paperclip >= 2026.9 scopes plugin config per company. Outside a host
// invocation that carries a company (plugin setup, scheduled jobs),
// `ctx.config.get()` without an argument throws, and before this fix that
// failed activation outright:
//   Worker initialize failed: ... is not allowed to perform "config.get":
//   company context is required
function makeHostRequireCompany(harness: ReturnType<typeof createHonchoHarness>) {
  const original = harness.ctx.config.get.bind(harness.ctx.config);
  const calls: Array<string | undefined> = [];
  harness.ctx.config.get = async (companyId?: string) => {
    calls.push(companyId);
    if (!companyId) {
      throw new Error('Plugin "honcho" is not allowed to perform "config.get": company context is required');
    }
    return await original(companyId);
  };
  return calls;
}

describe("company-scoped plugin config (Paperclip >= 2026.9)", () => {
  it("activates when config.get() needs a company during setup", async () => {
    installFetchMock();
    const harness = createHonchoHarness();
    makeHostRequireCompany(harness);

    await expect(plugin.definition.setup(harness.ctx)).resolves.not.toThrow();

    const result = await harness.performAction<Record<string, unknown>>("test-connection", {});
    expect(result.ok).toBe(true);
  });

  it("passes the known company and falls back to the only company otherwise", async () => {
    installFetchMock();
    const harness = createHonchoHarness();
    const calls = makeHostRequireCompany(harness);

    const scoped = await getResolvedConfig(harness.ctx, "co_1");
    expect(scoped.honchoApiBaseUrl).toBeTruthy();
    expect(calls).toEqual(["co_1"]);

    const fallback = await getResolvedConfig(harness.ctx);
    expect(fallback.honchoApiBaseUrl).toBe(scoped.honchoApiBaseUrl);
    expect(calls.slice(1)).toEqual([undefined, "co_1"]);
  });
});
