/**
 * Regression tests for #6571 — compression CLI REST fallback field mismatch
 * and [object Object] table rendering.
 *
 * Bug 1: the REST fallbacks in bin/cli/commands/compression.mjs read/write a
 *        nonexistent `engine` field, while GET/PUT /api/settings/compression
 *        uses `defaultMode`. So `engine get` always reports "(default)" and
 *        `engine set` silently no-ops.
 * Bug 2: formatCell() in bin/cli/output.mjs renders object-valued cells as the
 *        literal string "[object Object]" instead of readable JSON.
 */
import test from "node:test";
import assert from "node:assert/strict";

type FetchOpts = { method?: string; body?: string };

function makeResp(data: unknown, status = 200) {
  const obj = {
    ok: status < 400,
    status,
    exitCode: status < 400 ? 0 : 1,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  };
  obj.json = obj.json.bind(obj);
  obj.text = obj.text.bind(obj);
  return obj;
}

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c: string | Uint8Array) => {
    chunks.push(typeof c === "string" ? c : c.toString());
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

function makeCmd(output = "json") {
  return { optsWithGlobals: () => ({ output, quiet: output !== "table" }) };
}

// ─── Bug 1a: `compression status` REST fallback reads `defaultMode` ───────────
test("#6571 restCompressionStatus reads defaultMode (not the nonexistent engine field)", async () => {
  const origFetch = globalThis.fetch;
  const mock = (url: string | URL, _opts?: FetchOpts) => {
    const u = String(url);
    if (u.includes("/api/mcp/tools/call")) return Promise.resolve(makeResp({}, 404)); // force REST fallback
    if (u.includes("/api/settings/compression"))
      return Promise.resolve(makeResp({ enabled: true, defaultMode: "stacked" }));
    if (u.includes("/api/context/combos")) return Promise.resolve(makeResp({ combos: [] }));
    if (u.includes("/api/context/analytics")) return Promise.resolve(makeResp(null, 404));
    return Promise.resolve(makeResp({}));
  };
  globalThis.fetch = mock as unknown as typeof fetch;

  const { runCompressionStatus } = await import("../../bin/cli/commands/compression.mjs");
  const out = await captureStdout(() => runCompressionStatus({}, makeCmd()));

  globalThis.fetch = origFetch;
  const parsed = JSON.parse(out);
  // Before the fix `engine` was `settings.engine ?? null` → always null.
  assert.equal(parsed.engine, "stacked", `expected engine "stacked", got: ${out}`);
});

// ─── Bug 1b: `compression engine set` REST fallback PUTs `defaultMode` ────────
test("#6571 restSetEngine PUTs defaultMode, not the ignored engine field", async () => {
  let putBody: Record<string, unknown> | null = null;
  const origFetch = globalThis.fetch;
  const mock = (url: string | URL, opts?: FetchOpts) => {
    const u = String(url);
    if (u.includes("/api/mcp/tools/call")) return Promise.resolve(makeResp({}, 404));
    if (u.includes("/api/settings/compression")) {
      if (opts?.method === "PUT" && opts?.body) putBody = JSON.parse(opts.body);
      return Promise.resolve(makeResp({ success: true }));
    }
    return Promise.resolve(makeResp({}));
  };
  globalThis.fetch = mock as unknown as typeof fetch;

  const { runCompressionEngineSet } = await import("../../bin/cli/commands/compression.mjs");
  await captureStdout(() => runCompressionEngineSet("stacked", {}, makeCmd()));

  globalThis.fetch = origFetch;
  assert.ok(putBody, "expected a PUT to /api/settings/compression");
  assert.equal(putBody!.defaultMode, "stacked", "PUT body must carry defaultMode");
  assert.equal(putBody!.engine, undefined, "PUT body must not carry the ignored engine field");
});

// ─── Bug 1b: caveman → "standard" translation parity with the MCP handler ────
test("#6571 restSetEngine translates caveman → standard (defaultMode)", async () => {
  let putBody: Record<string, unknown> | null = null;
  const origFetch = globalThis.fetch;
  const mock = (url: string | URL, opts?: FetchOpts) => {
    const u = String(url);
    if (u.includes("/api/mcp/tools/call")) return Promise.resolve(makeResp({}, 404));
    if (u.includes("/api/settings/compression")) {
      if (opts?.method === "PUT" && opts?.body) putBody = JSON.parse(opts.body);
      return Promise.resolve(makeResp({ success: true }));
    }
    return Promise.resolve(makeResp({}));
  };
  globalThis.fetch = mock as unknown as typeof fetch;

  const { runCompressionEngineSet } = await import("../../bin/cli/commands/compression.mjs");
  await captureStdout(() => runCompressionEngineSet("caveman", {}, makeCmd()));

  globalThis.fetch = origFetch;
  assert.ok(putBody, "expected a PUT to /api/settings/compression");
  assert.equal(putBody!.defaultMode, "standard", "caveman must map to defaultMode=standard");
});

// ─── Bug 2: formatCell renders objects as JSON, not "[object Object]" ─────────
test("#6571 table output renders nested objects as JSON, not [object Object]", async () => {
  const { emit } = await import("../../bin/cli/output.mjs");
  const schema = [
    { key: "name", header: "Name" },
    { key: "settings", header: "Settings" },
  ];
  const out = await captureStdout(() =>
    emit(
      [{ name: "compression", settings: { enabled: true, defaultMode: "stacked" } }],
      { output: "table" },
      schema
    )
  );
  assert.ok(!out.includes("[object Object]"), `object cell must not render as [object Object], got: ${out}`);
  assert.ok(out.includes("stacked"), `object cell should show its content, got: ${out}`);
});
