import { eq } from "drizzle-orm";
import { db } from "@/db";
import { providerKeys } from "@/db/schema";
import {
  OPENROUTER_ENV_KEYS,
  PROVIDER_MAP,
  type ProviderConfig,
  type ProviderId,
  type TransportKind,
} from "./providers";

export type ResolvedRoute = {
  transport: TransportKind;
  model: string;
  apiKey: string;
  baseUrl: string;
  source: "db" | "env" | "openrouter-env" | "demo";
};

function readEnvKey(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 8) return value.trim();
  }
  return undefined;
}

export async function getStoredKeys(): Promise<Record<string, { apiKey: string; model: string }>> {
  try {
    const rows = await db.select().from(providerKeys);
    return rows.reduce<Record<string, { apiKey: string; model: string }>>((acc, row) => {
      acc[row.provider] = { apiKey: row.apiKey, model: row.model };
      return acc;
    }, {});
  } catch {
    return {};
  }
}

/**
 * Decides how a provider should be reached: native API key (DB or env),
 * OpenRouter fallback key, or the built-in offline demo engine.
 */
export async function resolveRoute(providerId: ProviderId): Promise<ResolvedRoute> {
  const provider: ProviderConfig = PROVIDER_MAP[providerId];
  const stored = (await getStoredKeys())[providerId];

  if (stored?.apiKey && stored.apiKey.trim().length > 8) {
    return {
      transport: provider.nativeTransport,
      model: stored.model?.trim() || provider.defaultModel,
      apiKey: stored.apiKey.trim(),
      baseUrl: provider.baseUrl,
      source: "db",
    };
  }

  const envKey = readEnvKey(provider.envKeys);
  if (envKey) {
    return {
      transport: provider.nativeTransport,
      model: provider.defaultModel,
      apiKey: envKey,
      baseUrl: provider.baseUrl,
      source: "env",
    };
  }

  const openRouterKey = readEnvKey(OPENROUTER_ENV_KEYS);
  if (openRouterKey) {
    return {
      transport: "openrouter",
      model: provider.openrouterModel,
      apiKey: openRouterKey,
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      source: "openrouter-env",
    };
  }

  return {
    transport: "demo",
    model: `${provider.shortName}-demo`,
    apiKey: "",
    baseUrl: "",
    source: "demo",
  };
}

export async function resolveRoutes(): Promise<Record<ProviderId, ResolvedRoute>> {
  const entries = await Promise.all(
    (Object.keys(PROVIDER_MAP) as ProviderId[]).map(async (id) => [id, await resolveRoute(id)] as const),
  );
  return entries.reduce<Record<ProviderId, ResolvedRoute>>((acc, [id, route]) => {
    acc[id] = route;
    return acc;
  }, {} as Record<ProviderId, ResolvedRoute>);
}

export async function upsertKey(provider: string, apiKey: string, model: string) {
  const existing = await db
    .select()
    .from(providerKeys)
    .where(eq(providerKeys.provider, provider))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(providerKeys)
      .set({
        apiKey: apiKey.trim(),
        model: model.trim(),
        updatedAt: new Date(),
      })
      .where(eq(providerKeys.provider, provider));
    return;
  }

  await db.insert(providerKeys).values({
    provider,
    apiKey: apiKey.trim(),
    model: model.trim(),
  });
}
