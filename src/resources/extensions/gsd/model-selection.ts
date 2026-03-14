type ModelRef = {
  provider: string;
  id: string;
};

type StoredModelRef = {
  provider: string;
  modelId: string;
};

export function modelsEqual(a: ModelRef | undefined | null, b: ModelRef | undefined | null): boolean {
  return !!a && !!b && a.provider === b.provider && a.id === b.id;
}

export function modelMatchesStoredRef(model: ModelRef | undefined | null, ref: StoredModelRef | undefined | null): boolean {
  return !!model && !!ref && model.provider === ref.provider && model.id === ref.modelId;
}

export function findModelByPattern<T extends ModelRef>(models: T[], pattern: string): T | undefined {
  const slashIdx = pattern.indexOf("/");
  if (slashIdx > 0) {
    const provider = pattern.slice(0, slashIdx);
    const modelId = pattern.slice(slashIdx + 1);
    return models.find((model) => model.provider === provider && model.id === modelId);
  }

  return models.find((model) => model.id === pattern);
}

export function pickPreferredStartupModel<T extends ModelRef>(models: T[]): T | undefined {
  return (
    models.find((model) => model.provider === "anthropic" && model.id === "claude-opus-4-6") ||
    models.find((model) => model.provider === "anthropic" && model.id.includes("opus")) ||
    models.find((model) => model.provider === "anthropic") ||
    models[0]
  );
}
