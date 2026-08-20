import type { TransportKind } from "./providers";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StreamRequest = {
  transport: TransportKind;
  model: string;
  apiKey: string;
  baseUrl: string;
  system: string;
  history: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
};

async function* readSse(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        yield trimmed.slice(5).trim();
      }
    }
  }
}

function extractDelta(transport: TransportKind, payload: unknown): string {
  const data = payload as Record<string, any>;
  if (transport === "anthropic") {
    if (data?.type === "content_block_delta") {
      const delta = data.delta as Record<string, any> | undefined;
      return typeof delta?.text === "string" ? delta.text : "";
    }
    return "";
  }
  if (transport === "google") {
    const parts = data?.candidates?.[0]?.content?.parts as Array<Record<string, any>> | undefined;
    if (!Array.isArray(parts)) return "";
    return parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  const choice = data?.choices?.[0];
  const delta = choice?.delta as Record<string, any> | undefined;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content
      .map((chunk: Record<string, any>) => (typeof chunk?.text === "string" ? chunk.text : ""))
      .join("");
  }
  if (typeof choice?.message?.content === "string") return choice.message.content;
  return "";
}

async function throwApiError(response: Response): Promise<never> {
  let detail = "";
  try {
    const text = await response.text();
    detail = text.slice(0, 400);
  } catch {
    detail = "";
  }
  throw new Error(`API hiba (${response.status}): ${detail || response.statusText}`);
}

async function* streamOpenAiCompatible(
  request: StreamRequest,
  extraHeaders: Record<string, string> = {},
): AsyncGenerator<string> {
  const response = await fetch(request.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: request.model,
      stream: true,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 700,
      messages: [{ role: "system", content: request.system }, ...request.history],
    }),
  });

  if (!response.ok) await throwApiError(response);

  for await (const data of readSse(response)) {
    if (!data || data === "[DONE]") continue;
    try {
      const text = extractDelta("openai", JSON.parse(data));
      if (text) yield text;
    } catch {
      // ignore malformed keepalive frames
    }
  }
}

async function* streamAnthropic(request: StreamRequest): AsyncGenerator<string> {
  const response = await fetch(request.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens ?? 700,
      temperature: request.temperature ?? 0.7,
      system: request.system,
      stream: true,
      messages: request.history,
    }),
  });

  if (!response.ok) await throwApiError(response);

  for await (const data of readSse(response)) {
    if (!data) continue;
    try {
      const text = extractDelta("anthropic", JSON.parse(data));
      if (text) yield text;
    } catch {
      // ignore
    }
  }
}

async function* streamGoogle(request: StreamRequest): AsyncGenerator<string> {
  const url = `${request.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse`;
  const contents = request.history.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": request.apiKey,
    },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: request.system }] },
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 700,
      },
    }),
  });

  if (!response.ok) await throwApiError(response);

  for await (const data of readSse(response)) {
    if (!data) continue;
    try {
      const text = extractDelta("google", JSON.parse(data));
      if (text) yield text;
    } catch {
      // ignore
    }
  }
}

export function streamChat(request: StreamRequest): AsyncGenerator<string> {
  switch (request.transport) {
    case "openai":
    case "openrouter":
      return streamOpenAiCompatible(
        request,
        request.transport === "openrouter"
          ? { "HTTP-Referer": "https://ai-group-chat.local", "X-Title": "AI Group Chat" }
          : {},
      );
    case "anthropic":
      return streamAnthropic(request);
    case "google":
      return streamGoogle(request);
    default:
      return demoStream(request);
  }
}

/* ------------------------------------------------------------------ */
/* Offline demo engine – keeps the group chat alive without API keys. */
/* ------------------------------------------------------------------ */

const DEMO_TEMPLATES: Record<string, string[]> = {
  chatgpt: [
    "Röviden összefoglalva: {topic}. Három lépésben gondolkoznék rajta: 1) mi a cél, 2) mi a legkisebb működő megoldás, 3) mit mérünk. Ha adsz egy kis kontextust, konkrét tervet is írok.",
    "Én kicsit másképp látnám, mint a többiek: {topic} esetén a legnagyobb kockázat általában a hatókör, nem a technológia. Egy 1 oldalas terv sokat segítene.",
  ],
  copilot: [
    "Microsoft-os szemmel: {topic} egy jól behatárolható munkafolyamat. Én egy vázlatot csinálnék róla, kiosztanám a lépéseket, és beiktatnék egy gyors ellenőrző pontot a végén.",
    "Hozzátenném, hogy {topic}nél a dokumentáció és az ismételhetőség visz előre. Szeretek checklist-ben gondolkodni.",
  ],
  gemini: [
    "Nézőpontváltás: {topic}. Az egyik oldal a sebesség, a másik a megbízhatóság — érdemes mindkettőnek teret adni, és egy hét múlva megnézni, mi működött.",
    "Röviden: {topic}. Én azt nézném, mi az, amit már ma meg lehet csinálni, és mi az, ami várhat.",
  ],
  perplexity: [
    "Amit a friss források mutatnak: {topic} terén a legtöbb csapat a gyors iterációra helyezi a hangsúlyt. A lényeg, hogy mérhető legyen, amit csinálsz.",
    "Tény-ellenőrzés: {topic} — itt tényleg érdemes ellenőrizni a számokat, mert sok case study túlzó. Kérdezz rá a forrásokra.",
  ],
  claude: [
    "Észrevettem, hogy a kérdés két rétege: {topic}. Az első a gyakorlati (mit tegyünk most), a második az elvi (miért ezt). Utóbbin múlik, hogy a döntés sokáig kitart-e.",
    "Kicsit finomítanám az előbbieket: {topic} esetén a legkevésbé kézenfekvő opció gyakran a legjobb. Mi az, amit még nem fontolgattunk?",
  ],
};

const DEMO_OPENERS: Record<string, string[]> = {
  chatgpt: ["Oké, nézzük gyakorlatiasan:", "Strukturálva:", "A lényeg röviden:"],
  copilot: ["Produktivitási szempontból:", "Copilot-ként így látnám:", "Egy gyors javaslat:"],
  gemini: ["Több szemszögből:", "Röviden és világosan:", "Így látom én:"],
  perplexity: ["Források alapján:", "Gyors tény-ellenőrzés:", "Amit a legtöbb csapat csinál:"],
  claude: ["Átgondolva:", "Ez egy kicsit árnyaltabb kérdés:", "Finomítanám a képletet:"],
};

const DEMO_REACTIONS = [
  "Az előző válasz jó kiindulás, én a mérhetőséget tenném bele.",
  "Részben egyetértek, de a kivitelezés a nehezebb rész.",
  "Egy dolgot kihagyna: a költség oldalt is érdemes megnézni.",
  "Inkább a sorrend kérdése ez: mi jön előbb, és mi várhat.",
  "Hozzátenném, hogy kicsiben érdemes kezdeni, és csak akkor skálázni, ha már működik.",
];

function pick<T>(items: T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

export async function* demoStream(request: StreamRequest): AsyncGenerator<string> {
  const providerKey = request.model.replace(/-demo$/, "").toLowerCase();
  const lastUser = [...request.history].reverse().find((turn) => turn.role === "user");
  const lastAssistant = [...request.history].reverse().find((turn) => turn.role === "assistant");

  const clean = (input: string) =>
    input
      .replace(/^\s*[\w áéíóöőúüű.-]{1,24}:\s*/u, "")
      .replace(/\s+/g, " ")
      .trim();

  const question = clean(lastUser?.content ?? "a téma")
    .replace(/@[\w-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110) || "a téma";

  const providerSeed = [...providerKey].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const seed = question.length * 7 + providerSeed + (lastAssistant ? 5 : 0);
  const template = pick(DEMO_TEMPLATES[providerKey] ?? DEMO_TEMPLATES.chatgpt, seed);

  const opener = pick(DEMO_OPENERS[providerKey] ?? DEMO_OPENERS.chatgpt, seed + providerSeed);
  const body = template.replace(/^[^:]{3,32}:\s*/u, "").replace("{topic}", `„${question}”`);

  const reaction = lastAssistant ? ` ${pick(DEMO_REACTIONS, seed + 2)}` : "";

  const closing = pick(
    ["", "", " Ti hogyan csinálnátok?", " Melyik irány érdekel jobban?", " Szólj, ha kérsz konkrét tervet is."],
    seed + 3,
  );

  const text = `${opener} ${body}${reaction}${closing}`;
  const tokens = text.split(/(\s+)/);
  for (const token of tokens) {
    if (!token) continue;
    yield token;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
