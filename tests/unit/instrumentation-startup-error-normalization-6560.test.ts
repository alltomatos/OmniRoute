import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStartupError } from "../../src/instrumentation-node";

test("normalizeStartupError passes an existing Error instance through unchanged", () => {
  const original = new Error("Database closed");
  assert.equal(normalizeStartupError(original), original);
});

test("normalizeStartupError wraps a raw string rejection (#6560 repro) into a real Error", () => {
  const normalized = normalizeStartupError("Database closed");
  assert.ok(normalized instanceof Error);
  assert.equal(normalized.message, "Database closed");
  // Must not throw — this is exactly the crash #6560 reports when downstream
  // code assumes an Error shape and assigns `.message` on a bare string.
  assert.doesNotThrow(() => {
    normalized.message = `${normalized.message} (during startup)`;
  });
});

test("normalizeStartupError wraps non-string, non-Error throws (null/number/object)", () => {
  assert.equal(normalizeStartupError(null).message, "null");
  assert.equal(normalizeStartupError(undefined).message, "undefined");
  assert.equal(normalizeStartupError(42).message, "42");
  assert.equal(normalizeStartupError({ code: "ERR" }).message, "[object Object]");
});
