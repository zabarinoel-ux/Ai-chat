export type ProviderId = "chatgpt" | "copilot" | "gemini" | "perplexity" | "claude";
export type TransportKind = "openai" | "anthropic" | "google" | "openrouter" | "demo";

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  shortName: string;
  vendor: string;
  emoji: string;
  accent: string;
  glow: string;
  tagline: string;
  defaultModel: string;
  /** Model used when the request is routed through OpenRouter. */
  openrouterModel: string;
  envKeys: string[];
  baseUrl: string;
  nativeTransport: TransportKind;
  persona: string;
};

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    shortName: "GPT",
    vendor: "OpenAI",
    emoji: "🟢",
    accent: "from-emerald-500 to-teal-500",
    glow: "shadow-emerald-500/30",
    tagline: "OpenAI · GPT modellek",
    defaultModel: "gpt-4o-mini",
    openrouterModel: "openai/gpt-4o-mini",
    envKeys: ["OPENAI_API_KEY", "OPENAI_KEY"],
    baseUrl: "https://api.openai.com/v1/chat/completions",
    nativeTransport: "openai",
    persona:
      "Te ChatGPT vagy, az OpenAI modellje. Gyakorlatias, strukturált, szeret példát és lépéseket adni.",
  },
  {
    id: "copilot",
    name: "Copilot",
    shortName: "Copilot",
    vendor: "Microsoft / GitHub Models",
    emoji: "🔷",
    accent: "from-sky-500 to-blue-600",
    glow: "shadow-sky-500/30",
    tagline: "Microsoft · GitHub Models inference",
    defaultModel: "openai/gpt-4o",
    openrouterModel: "openai/gpt-4o",
    envKeys: ["COPILOT_API_KEY", "GITHUB_TOKEN", "GITHUB_MODELS_TOKEN"],
    baseUrl: "https://models.github.ai/inference/chat/completions",
    nativeTransport: "openai",
    persona:
      "Te Microsoft Copilot vagy. Udvarias, produktivitás-fókuszú, szeretsz konkrét tippeket és workflow ötleteket adni.",
  },
  {
    id: "gemini",
    name: "Gemini",
    shortName: "Gemini",
    vendor: "Google",
    emoji: "✨",
    accent: "from-blue-400 to-fuchsia-500",
    glow: "shadow-fuchsia-500/30",
    tagline: "Google · Gemini modellek",
    defaultModel: "gemini-2.0-flash",
    openrouterModel: "google/gemini-2.0-flash-001",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    nativeTransport: "google",
    persona:
      "Te Gemini vagy, a Google modellje. Rövid, világos válaszok, szeret több szemszögből gondolkodni.",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    shortName: "PPLX",
    vendor: "Perplexity AI",
    emoji: "🟣",
    accent: "from-teal-400 to-cyan-600",
    glow: "shadow-cyan-500/30",
    tagline: "Perplexity · sonar (kereső alapú)",
    defaultModel: "sonar",
    openrouterModel: "perplexity/sonar",
    envKeys: ["PERPLEXITY_API_KEY"],
    baseUrl: "https://api.perplexity.ai/chat/completions",
    nativeTransport: "openai",
    persona:
      "Te Perplexity vagy. Tényekre és friss forrásokra építesz, szeretsz rövid, kutatás-alapú összefoglalót adni.",
  },
  {
    id: "claude",
    name: "Claude",
    shortName: "Claude",
    vendor: "Anthropic",
    emoji: "🟠",
    accent: "from-orange-400 to-amber-600",
    glow: "shadow-amber-500/30",
    tagline: "Anthropic · Claude modellek",
    defaultModel: "claude-sonnet-4-5",
    openrouterModel: "anthropic/claude-sonnet-4.5",
    envKeys: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    baseUrl: "https://api.anthropic.com/v1/messages",
    nativeTransport: "anthropic",
    persona:
      "Te Claude vagy, az Anthropic modellje. Átgondolt, árnyalt, szívesen vitatkozol és kétségbe vonod a többi AI állításait.",
  },
];

export const PROVIDER_MAP: Record<ProviderId, ProviderConfig> = PROVIDERS.reduce(
  (acc, provider) => {
    acc[provider.id] = provider;
    return acc;
  },
  {} as Record<ProviderId, ProviderConfig>,
);

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((provider) => provider.id === value);
}

export const OPENROUTER_ENV_KEYS = ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"];
