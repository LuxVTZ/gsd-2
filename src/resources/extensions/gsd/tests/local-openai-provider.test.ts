import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLocalOpenAICredentials,
  buildLocalOpenAICredentials,
  normalizeBaseUrl,
  normalizeModelId,
  registerLocalOpenAIProvider,
} from "../local-openai-provider.ts";

test("normalizeBaseUrl appends /v1 when only origin is provided", () => {
  assert.equal(normalizeBaseUrl("http://localhost:8317"), "http://localhost:8317/v1");
});

test("normalizeBaseUrl keeps explicit path and strips query/hash", () => {
  assert.equal(
    normalizeBaseUrl("http://localhost:8317/custom/path/?foo=1#bar"),
    "http://localhost:8317/custom/path",
  );
});

test("buildLocalOpenAICredentials stores normalized login fields", () => {
  const creds = buildLocalOpenAICredentials("http://localhost:8317", "sk-test", "gpt-5.4");
  assert.equal(creds.access, "sk-test");
  assert.equal(creds.refresh, "sk-test");
  assert.equal(creds.baseUrl, "http://localhost:8317/v1");
  assert.equal(creds.model, "gpt-5.4");
});

test("applyLocalOpenAICredentials rewrites local-openai model metadata", () => {
  const models = [
    {
      provider: "local-openai",
      id: "__configured_at_login__",
      name: "Configured At Login",
      api: "openai-completions",
      input: ["text"],
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
      baseUrl: "http://localhost:8317/v1",
    },
    {
      provider: "anthropic",
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      input: ["text"],
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384,
      baseUrl: "https://api.anthropic.com",
    },
  ];

  const updated = applyLocalOpenAICredentials(models as any, {
    refresh: "sk-test",
    access: "sk-test",
    expires: 4102444800000,
    baseUrl: "http://localhost:8317/v1",
    model: "gpt-5.4",
  });

  assert.equal(updated[0]?.id, "gpt-5.4");
  assert.equal(updated[0]?.name, "gpt-5.4 (Local OpenAI)");
  assert.equal(updated[0]?.baseUrl, "http://localhost:8317/v1");
  assert.equal(updated[1]?.id, "claude-sonnet-4-5");
});

test("registerLocalOpenAIProvider registers a /login-capable provider", () => {
  let registration: any;
  const pi = {
    registerProvider(name: string, config: unknown) {
      registration = { name, config };
    },
  };

  registerLocalOpenAIProvider(pi as any);

  assert.equal(registration?.name, "local-openai");
  assert.equal(registration?.config?.api, "openai-completions");
  assert.equal(registration?.config?.oauth?.name, "Local OpenAI-Compatible");
  assert.equal(typeof registration?.config?.oauth?.login, "function");
});
