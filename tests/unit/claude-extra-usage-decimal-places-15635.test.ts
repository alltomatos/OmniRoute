import test from "node:test";
import assert from "node:assert/strict";

import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaParsing";

test("parseQuotaData scales Claude extra_usage amounts using decimal_places (#15635)", () => {
  const data = {
    extraUsage: {
      is_enabled: true,
      monthly_limit: 6000,
      used_credits: 1500,
      currency: "SGD",
      decimal_places: 2,
    },
  };

  const quotas = parseQuotaData("claude", data);
  assert.equal(quotas.length, 1);
  const quota = quotas[0];
  assert.equal(quota.name, "extra_usage");
  assert.equal(quota.total, 60); // 6000 / 10^2
  assert.equal(quota.used, 15);  // 1500 / 10^2
  assert.equal(quota.remaining, 45); // (6000 - 1500) / 10^2
  assert.equal(quota.currency, "SGD");
  assert.equal(quota.isCredits, true);
});

test("parseQuotaData defaults to scale 1 when decimal_places is absent or 0", () => {
  const data = {
    extraUsage: {
      is_enabled: true,
      monthly_limit: 100,
      used_credits: 20,
      currency: "USD",
    },
  };

  const quotas = parseQuotaData("claude", data);
  assert.equal(quotas.length, 1);
  const quota = quotas[0];
  assert.equal(quota.name, "extra_usage");
  assert.equal(quota.total, 100);
  assert.equal(quota.used, 20);
  assert.equal(quota.remaining, 80);
});
