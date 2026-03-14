import type { ExtensionAPI, ModelRegistry } from "@gsd/pi-coding-agent";
import type { Model, OAuthCredentials, OAuthLoginCallbacks } from "@gsd/pi-ai";

type LocalOpenAICredentials = {
  refresh: string;
  access: string;
  expires: number;
  baseUrl?: unknown;
  model?: unknown;
};

const LOCAL_OPENAI_PATCH_FLAG = "__gsdLocalOpenAIPatched";

export const LOCAL_PROVIDER_ID = "local-openai";
const LOCAL_PROVIDER_NAME = "Local OpenAI-Compatible";
const LOCAL_MODEL_PLACEHOLDER = "__configured_at_login__";
const FAR_FUTURE_EXPIRY_MS = 4102444800000; // 2100-01-01T00:00:00.000Z
const DEFAULT_LOCAL_OPENAI_BASE_URL = "http://localhost:8317/v1";
const DEFAULT_LOCAL_OPENAI_API_KEY = "sk-test";
const DEFAULT_LOCAL_OPENAI_MODEL = "gpt-5.4";
const DEFAULT_LOCAL_MODEL_PROFILE = {
  reasoning: true,
  contextWindow: 128000,
  maxTokens: 16384,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    supportsStrictMode: false,
    maxTokensField: "max_tokens" as const,
  },
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Base URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL must be a valid URL such as http://localhost:8317/v1.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL must use http:// or https://.");
  }

  parsed.hash = "";
  parsed.search = "";
  const normalizedPath = trimTrailingSlash(parsed.pathname || "");
  if (!normalizedPath || normalizedPath === "/") {
    parsed.pathname = "/v1";
  } else {
    parsed.pathname = normalizedPath;
  }

  return trimTrailingSlash(parsed.toString());
}

export function normalizeModelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Model is required.");
  }
  return trimmed;
}

export function buildLocalOpenAICredentials(rawBaseUrl: string, rawApiKey: string, rawModel: string): LocalOpenAICredentials {
  const baseUrlInput = rawBaseUrl.trim() || DEFAULT_LOCAL_OPENAI_BASE_URL;
  const apiKey = rawApiKey.trim() || DEFAULT_LOCAL_OPENAI_API_KEY;
  const modelInput = rawModel.trim() || DEFAULT_LOCAL_OPENAI_MODEL;
  if (!apiKey) {
    throw new Error("API key is required.");
  }

  return {
    refresh: apiKey,
    access: apiKey,
    expires: FAR_FUTURE_EXPIRY_MS,
    baseUrl: normalizeBaseUrl(baseUrlInput),
    model: normalizeModelId(modelInput),
  };
}

function inferOpenAICompatibleProfile(modelId: string): {
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  compat?: Model<any>["compat"];
} {
  const normalized = modelId.trim().toLowerCase();

  // Local provider profile: both GPT-5.4 and GPT-5.3 Codex are capped to the
  // provider's currently available 272k context window, while keeping large
  // output token budgets and native OpenAI-style reasoning controls.
  if (normalized === "gpt-5.4") {
    return {
      reasoning: true,
      contextWindow: 272_000,
      maxTokens: 128_000,
      compat: undefined,
    };
  }

  // Support both dashed and non-dashed GPT-5.3 Codex slugs used by
  // OpenAI-compatible providers.
  if (
    normalized === "gpt-5.3-codex" ||
    normalized === "gpt5.3-codex" ||
    normalized === "gpt-5-codex" ||
    normalized === "gpt-5.1-codex-max" ||
    normalized.startsWith("gpt-5") && normalized.includes("codex")
  ) {
    return {
      reasoning: true,
      contextWindow: 272_000,
      maxTokens: 128_000,
      compat: undefined,
    };
  }

  // Generic GPT-5-family fallback: keep large context and OpenAI-like compat.
  if (normalized.startsWith("gpt-5")) {
    return {
      reasoning: true,
      contextWindow: 400_000,
      maxTokens: 128_000,
      compat: undefined,
    };
  }

  return DEFAULT_LOCAL_MODEL_PROFILE;
}

export function applyLocalOpenAICredentials(models: Model<any>[], credentials: LocalOpenAICredentials): Model<any>[] {
  const baseUrl = normalizeBaseUrl(String(credentials.baseUrl ?? ""));
  const modelId = normalizeModelId(String(credentials.model ?? ""));
  const inferred = inferOpenAICompatibleProfile(modelId);

  return models.map((model) => {
    if (model.provider !== LOCAL_PROVIDER_ID) return model;
    return {
      ...model,
      id: modelId,
      name: `${modelId} (Local OpenAI)`,
      baseUrl,
      reasoning: inferred.reasoning,
      contextWindow: inferred.contextWindow,
      maxTokens: inferred.maxTokens,
      compat: inferred.compat,
    };
  });
}

export function createLocalOpenAIProviderConfig(): Parameters<ExtensionAPI["registerProvider"]>[1] {
  return {
    baseUrl: DEFAULT_LOCAL_OPENAI_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: LOCAL_MODEL_PLACEHOLDER,
        name: "Configured At Login",
        reasoning: true,
        input: ["text", "image"] as const,
        contextWindow: DEFAULT_LOCAL_MODEL_PROFILE.contextWindow,
        maxTokens: DEFAULT_LOCAL_MODEL_PROFILE.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: DEFAULT_LOCAL_MODEL_PROFILE.compat,
      },
    ],
    oauth: {
      name: LOCAL_PROVIDER_NAME,
      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const baseUrl = await callbacks.onPrompt({
          message: "Base URL (press Enter to use the local default)",
          placeholder: DEFAULT_LOCAL_OPENAI_BASE_URL,
        });
        const apiKey = await callbacks.onPrompt({
          message: "API key (press Enter to use the default test key)",
          placeholder: DEFAULT_LOCAL_OPENAI_API_KEY,
        });
        const model = await callbacks.onPrompt({
          message: "Model slug (press Enter to use the default model)",
          placeholder: DEFAULT_LOCAL_OPENAI_MODEL,
        });

        return buildLocalOpenAICredentials(baseUrl, apiKey, model);
      },
      async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
        return credentials;
      },
      getApiKey(credentials: OAuthCredentials): string {
        return String(credentials.access ?? credentials.refresh ?? "");
      },
      modifyModels(models: Model<any>[], credentials: OAuthCredentials): Model<any>[] {
        return applyLocalOpenAICredentials(models, credentials as LocalOpenAICredentials);
      },
    },
  };
}

export function registerLocalOpenAIProvider(pi: ExtensionAPI): void {
  pi.registerProvider(LOCAL_PROVIDER_ID, createLocalOpenAIProviderConfig());
}

export function suppressLocalOpenAISubscriptionBadge(modelRegistry: ModelRegistry): void {
  const registry = modelRegistry as ModelRegistry & { [LOCAL_OPENAI_PATCH_FLAG]?: boolean };
  if (registry[LOCAL_OPENAI_PATCH_FLAG]) return;

  const original = modelRegistry.isUsingOAuth.bind(modelRegistry);
  registry.isUsingOAuth = ((model) => {
    if (model?.provider === LOCAL_PROVIDER_ID) return false;
    return original(model);
  }) as typeof modelRegistry.isUsingOAuth;

  registry[LOCAL_OPENAI_PATCH_FLAG] = true;
}
