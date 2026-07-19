/**
 * Regression test for #7703 — proxy upsert must key on the identity tuple
 * (host + port + username) and treat `password` as a mutable field.
 *
 * Before the fix, upsertProxy() resolved an existing proxy by the FULL
 * credential tuple (host + port + username + password). Including the password
 * in the lookup key meant that a password-only change never matched an existing
 * row, so re-importing a proxy with a rotated password created a duplicate
 * instead of updating the original entry.
 *
 * Follow-up to #7594 (which added username to the identity key so that distinct
 * residential/gateway credentials sharing one host:port no longer collapse onto
 * a single row). This test asserts BOTH invariants hold:
 *   - password-only rotation updates in place (no duplicate) — #7703
 *   - distinct usernames on the same host:port stay separate rows — #7594
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-proxy-upsert-7703-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const proxiesDb = await import("../../src/lib/db/proxies.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if ((code === "EBUSY" || code === "EPERM") && attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("#7703 upsert updates in place when only the password changed (no duplicate)", async () => {
  const first = await proxiesDb.upsertProxy({
    name: "Rotating Proxy",
    type: "http",
    host: "gw.example.com",
    port: 8080,
    username: "user-a",
    password: "passA",
  });
  assert.equal(first.action, "created");

  const second = await proxiesDb.upsertProxy({
    name: "Rotating Proxy",
    type: "http",
    host: "gw.example.com",
    port: 8080,
    username: "user-a",
    password: "passB",
  });

  // Password-only change must UPDATE the existing row, not create a second one.
  assert.equal(second.action, "updated");
  assert.equal(second.proxy?.id, first.proxy?.id);

  const listed = await proxiesDb.listProxies();
  assert.equal(listed.length, 1, "expected a single proxy row after password rotation");

  const withSecrets = await proxiesDb.getProxyById(listed[0].id, { includeSecrets: true });
  assert.equal(withSecrets?.password, "passB", "password must be updated to the rotated value");
});

test("#7594 upsert keeps distinct usernames on the same host:port as separate rows", async () => {
  await proxiesDb.upsertProxy({
    name: "Session 1",
    type: "http",
    host: "gw.example.com",
    port: 8080,
    username: "user-session-1",
    password: "secret",
  });
  await proxiesDb.upsertProxy({
    name: "Session 2",
    type: "http",
    host: "gw.example.com",
    port: 8080,
    username: "user-session-2",
    password: "secret",
  });

  const listed = await proxiesDb.listProxies();
  assert.equal(listed.length, 2, "distinct-username imports must not collapse onto one row");
});
