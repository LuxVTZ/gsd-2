import test from "node:test";
import assert from "node:assert/strict";

import {
  findModelByPattern,
  modelMatchesStoredRef,
  modelsEqual,
  pickPreferredStartupModel,
} from "../model-selection.ts";

const models = [
  { provider: "local-openai", id: "gpt-5.4" },
  { provider: "openrouter", id: "deepseek/deepseek-r1" },
  { provider: "anthropic", id: "claude-sonnet-4-6" },
  { provider: "anthropic", id: "claude-opus-4-6" },
];

test("findModelByPattern resolves exact provider/model patterns", () => {
  const model = findModelByPattern(models, "local-openai/gpt-5.4");
  assert.deepEqual(model, { provider: "local-openai", id: "gpt-5.4" });
});

test("findModelByPattern preserves model ids containing slashes", () => {
  const model = findModelByPattern(models, "openrouter/deepseek/deepseek-r1");
  assert.deepEqual(model, { provider: "openrouter", id: "deepseek/deepseek-r1" });
});

test("findModelByPattern falls back to bare model id matching", () => {
  const model = findModelByPattern(models, "claude-opus-4-6");
  assert.deepEqual(model, { provider: "anthropic", id: "claude-opus-4-6" });
});

test("pickPreferredStartupModel prefers opus, then anthropic, then first available", () => {
  assert.deepEqual(pickPreferredStartupModel(models), { provider: "anthropic", id: "claude-opus-4-6" });
  assert.deepEqual(
    pickPreferredStartupModel([{ provider: "local-openai", id: "gpt-5.4" }]),
    { provider: "local-openai", id: "gpt-5.4" },
  );
});

test("model ref helpers compare provider and model id together", () => {
  assert.equal(
    modelsEqual(
      { provider: "local-openai", id: "gpt-5.4" },
      { provider: "local-openai", id: "gpt-5.4" },
    ),
    true,
  );
  assert.equal(
    modelMatchesStoredRef(
      { provider: "local-openai", id: "gpt-5.4" },
      { provider: "local-openai", modelId: "gpt-5.4" },
    ),
    true,
  );
  assert.equal(
    modelMatchesStoredRef(
      { provider: "anthropic", id: "gpt-5.4" },
      { provider: "local-openai", modelId: "gpt-5.4" },
    ),
    false,
  );
});
