/**
 * #6651 — `gpt-5.3-codex-spark` rejects the server-side `image_generation` hosted tool
 * upstream (HTTP 400) regardless of plan, but the Codex Desktop app / CLI injects it into
 * every Responses request. OmniRoute previously dropped `image_generation` only for
 * free-plan accounts (#2980), so a PAID account routing to spark still forwarded it and the
 * request failed upstream. `shouldDropCodexImageGeneration` must also drop it for the spark
 * scope. These tests also guard the free-plan behavior so #2980 does not regress.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { shouldDropCodexImageGeneration, normalizeCodexTools } = await import(
  "../../open-sse/executors/codex.ts"
);

const FREE = { workspacePlanType: "free" };
const PAID = { workspacePlanType: "team" };

test("shouldDropCodexImageGeneration: spark model drops image_generation on a paid plan (#6651)", () => {
  assert.equal(shouldDropCodexImageGeneration(PAID, "gpt-5.3-codex-spark"), true);
  // reasoning-suffixed spark variant (e.g. gpt-5.3-codex-spark:high) still counts as spark
  assert.equal(shouldDropCodexImageGeneration(PAID, "gpt-5.3-codex-spark:high"), true);
});

test("shouldDropCodexImageGeneration: free plan still drops it for non-spark models (#2980 guard)", () => {
  assert.equal(shouldDropCodexImageGeneration(FREE, "gpt-5.3-codex"), true);
  assert.equal(shouldDropCodexImageGeneration(FREE, undefined), true);
});

test("shouldDropCodexImageGeneration: paid plan + non-spark model preserves image_generation", () => {
  assert.equal(shouldDropCodexImageGeneration(PAID, "gpt-5.3-codex"), false);
  assert.equal(shouldDropCodexImageGeneration(undefined, "gpt-5.3-codex"), false);
});

test("normalizeCodexTools drops image_generation for a paid spark request end-to-end (#6651)", () => {
  const body: Record<string, unknown> = {
    model: "gpt-5.3-codex-spark",
    tools: [
      { type: "image_generation", output_format: "png" },
      { type: "function", name: "foo", parameters: { type: "object" } },
    ],
  };
  normalizeCodexTools(body, {
    dropImageGeneration: shouldDropCodexImageGeneration(PAID, body.model as string),
  });
  const tools = body.tools as Array<{ type?: string }>;
  assert.equal(
    tools.some((t) => t.type === "image_generation"),
    false,
    "image_generation must be dropped for a paid spark request"
  );
  assert.equal(tools.length, 1, "the function tool must survive");
});
