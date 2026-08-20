import { PROVIDERS } from "@/lib/ai/providers";
import { getStoredKeys, resolveRoutes, upsertKey } from "@/lib/ai/keys";
import { isProviderId } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

function mask(key: string) {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`;
}

export async function GET() {
  const [routes, stored] = await Promise.all([resolveRoutes(), getStoredKeys()]);
  return Response.json({
    providers: PROVIDERS.map((provider) => {
      const route = routes[provider.id];
      return {
        id: provider.id,
        name: provider.name,
        tagline: provider.tagline,
        defaultModel: provider.defaultModel,
        envKeys: provider.envKeys,
        live: route.transport !== "demo",
        transport: route.transport,
        source: route.source,
        model: route.model,
        maskedKey: mask(stored[provider.id]?.apiKey ?? ""),
      };
    }),
    openrouterAvailable: PROVIDERS.some((p) => routes[p.id].source === "openrouter-env"),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    provider?: string;
    apiKey?: string;
    model?: string;
  };

  if (!body.provider || !isProviderId(body.provider)) {
    return Response.json({ error: "Érvénytelen szolgáltató." }, { status: 400 });
  }

  await upsertKey(body.provider, body.apiKey ?? "", body.model ?? "");
  const [routes, stored] = await Promise.all([resolveRoutes(), getStoredKeys()]);
  const route = routes[body.provider];

  return Response.json({
    ok: true,
    live: route.transport !== "demo",
    transport: route.transport,
    model: route.model,
    maskedKey: mask(stored[body.provider]?.apiKey ?? ""),
  });
}
