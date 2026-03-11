import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

type LocalOpenAICredentials = {
  refresh: string;
  access: string;
  expires: number;
  baseUrl?: unknown;
  model?: unknown;
};

const LOCAL_PROVIDER_ID = "local-openai";
const LOCAL_PROVIDER_NAME = "Local OpenAI-Compatible";
const LOCAL_MODEL_PLACEHOLDER = "__configured_at_login__";
const FAR_FUTURE_EXPIRY_MS = 4102444800000; // 2100-01-01T00:00:00.000Z

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
  const apiKey = rawApiKey.trim();
  if (!apiKey) {
    throw new Error("API key is required.");
  }

  return {
    refresh: apiKey,
    access: apiKey,
    expires: FAR_FUTURE_EXPIRY_MS,
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    model: normalizeModelId(rawModel),
  };
}

export function applyLocalOpenAICredentials(models: Model<any>[], credentials: LocalOpenAICredentials): Model<any>[] {
  const baseUrl = normalizeBaseUrl(String(credentials.baseUrl ?? ""));
  const modelId = normalizeModelId(String(credentials.model ?? ""));

  return models.map((model) => {
    if (model.provider !== LOCAL_PROVIDER_ID) return model;
    return {
      ...model,
      id: modelId,
      name: `${modelId} (Local OpenAI)`,
      baseUrl,
    };
  });
}

export function registerLocalOpenAIProvider(pi: ExtensionAPI): void {
  pi.registerProvider(LOCAL_PROVIDER_ID, {
    baseUrl: "http://localhost:8317/v1",
    api: "openai-completions",
    models: [
      {
        id: LOCAL_MODEL_PLACEHOLDER,
        name: "Configured At Login",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
    ],
    oauth: {
      name: LOCAL_PROVIDER_NAME,
      async login(callbacks) {
        callbacks.onAuth({
          url: "http://localhost:8317/v1",
          instructions: "Enter your local OpenAI-compatible endpoint, API key, and model slug.",
        });

        const baseUrl = await callbacks.onPrompt({
          message: "Base URL",
          placeholder: "http://localhost:8317/v1",
        });
        const apiKey = await callbacks.onPrompt({
          message: "API key",
          placeholder: "sk-test",
        });
        const model = await callbacks.onPrompt({
          message: "Model",
          placeholder: "gpt-5.4",
        });

        return buildLocalOpenAICredentials(baseUrl, apiKey, model);
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return String(credentials.access ?? credentials.refresh ?? "");
      },
      modifyModels(models, credentials) {
        return applyLocalOpenAICredentials(models, credentials as LocalOpenAICredentials);
      },
    },
  });
}
