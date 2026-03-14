import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLocalOpenAICredentials,
  buildLocalOpenAICredentials,
  createLocalOpenAIProviderConfig,
  normalizeBaseUrl,
  normalizeModelId,
  registerLocalOpenAIProvider,
  suppressLocalOpenAISubscriptionBadge,
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

test("buildLocalOpenAICredentials falls back to login defaults when inputs are empty", () => {
  const creds = buildLocalOpenAICredentials("", "", "");
  assert.equal(creds.access, "sk-test");
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
  assert.equal(updated[0]?.contextWindow, 272_000);
  assert.equal(updated[0]?.maxTokens, 128_000);
  assert.equal(updated[0]?.compat, undefined);
  assert.equal(updated[1]?.id, "claude-sonnet-4-5");
});

test("applyLocalOpenAICredentials infers larger context window for gpt-5.3-codex", () => {
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
      compat: { supportsStore: false, maxTokensField: "max_tokens" },
    },
  ];

  const updated = applyLocalOpenAICredentials(models as any, {
    refresh: "sk-test",
    access: "sk-test",
    expires: 4102444800000,
    baseUrl: "http://localhost:8317/v1",
    model: "gpt-5.3-codex",
  });

  assert.equal(updated[0]?.contextWindow, 272_000);
  assert.equal(updated[0]?.maxTokens, 128_000);
  assert.equal(updated[0]?.reasoning, true);
  assert.equal(updated[0]?.compat, undefined);
});

test("applyLocalOpenAICredentials supports non-dashed gpt5.3-codex slug", () => {
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
  ];

  const updated = applyLocalOpenAICredentials(models as any, {
    refresh: "sk-test",
    access: "sk-test",
    expires: 4102444800000,
    baseUrl: "http://localhost:8317/v1",
    model: "gpt5.3-codex",
  });

  assert.equal(updated[0]?.id, "gpt5.3-codex");
  assert.equal(updated[0]?.contextWindow, 272_000);
  assert.equal(updated[0]?.maxTokens, 128_000);
  assert.equal(updated[0]?.reasoning, true);
  assert.equal(updated[0]?.compat, undefined);
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

test("createLocalOpenAIProviderConfig uses compatibility-first flags for generic endpoints", () => {
  const config = createLocalOpenAIProviderConfig();
  const model = config.models[0];

  assert.equal(model.compat?.supportsStore, false);
  assert.equal(model.compat?.supportsStrictMode, false);
  assert.equal(model.compat?.supportsDeveloperRole, false);
  assert.equal(model.compat?.supportsReasoningEffort, false);
  assert.equal(model.compat?.supportsUsageInStreaming, false);
  assert.equal(model.compat?.maxTokensField, "max_tokens");
});

test("local-openai login uses prompt flow without browser auth", async () => {
  const config = createLocalOpenAIProviderConfig();
  const prompts: string[] = [];
  let authShown = false;

  const credentials = await config.oauth.login({
    onAuth() {
      authShown = true;
    },
    onPrompt({ message }: { message: string }) {
      prompts.push(message);
      return Promise.resolve("");
    },
  } as any);

  assert.equal(authShown, false);
  assert.deepEqual(prompts, [
    "Base URL (press Enter to use the local default)",
    "API key (press Enter to use the default test key)",
    "Model slug (press Enter to use the default model)",
  ]);
  assert.equal(credentials.baseUrl, "http://localhost:8317/v1");
  assert.equal(credentials.model, "gpt-5.4");
});

test("suppressLocalOpenAISubscriptionBadge hides oauth subscription marker for local-openai only", () => {
  const registry = {
    isUsingOAuth(model: { provider: string }) {
      return model.provider === "local-openai" || model.provider === "anthropic";
    },
  };

  suppressLocalOpenAISubscriptionBadge(registry as any);

  assert.equal(registry.isUsingOAuth({ provider: "local-openai" } as any), false);
  assert.equal(registry.isUsingOAuth({ provider: "anthropic" } as any), true);
});
