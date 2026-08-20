import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, roomParticipants, rooms } from "@/db/schema";
import { resolveRoute } from "@/lib/ai/keys";
import { PROVIDER_MAP, type ProviderId } from "@/lib/ai/providers";
import { streamChat } from "@/lib/ai/stream";
import {
  buildParticipants,
  buildSystemPrompt,
  extractMentions,
  getOnlineHumans,
  getRecentMessages,
  getRoom,
  historyToTurns,
} from "./data";

const inflight = new Set<string>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function selectResponders(
  content: string,
  autoMode: string,
  enabled: ProviderId[],
  messageCount: number,
): ProviderId[] {
  if (enabled.length === 0) return [];
  const mentions = extractMentions(content).filter((id) => enabled.includes(id));

  if (mentions.length > 0) return mentions;

  const lower = content.toLowerCase();
  if (/\b(mind|mindenki|all|mindenki)\b/.test(lower)) return enabled;

  switch (autoMode) {
    case "off":
      return [];
    case "mentioned":
      return [];
    case "random": {
      const pool = [...enabled];
      const take = Math.min(pool.length, 1 + Math.floor(Math.random() * 2));
      const picked: ProviderId[] = [];
      while (picked.length < take && pool.length > 0) {
        const index = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(index, 1)[0]);
      }
      return picked;
    }
    case "round_robin": {
      return [enabled[messageCount % enabled.length]];
    }
    default:
      return enabled;
  }
}

async function runReply(options: {
  roomId: string;
  roomName: string;
  topic: string;
  providerId: ProviderId;
  persona: string;
  history: Array<typeof messages.$inferSelect>;
  onlineHumans: string[];
  lastHumanName: string;
  roster: string[];
  startDelayMs: number;
}) {
  const {
    roomId,
    roomName,
    topic,
    providerId,
    persona,
    history,
    onlineHumans,
    lastHumanName,
    roster,
    startDelayMs,
  } = options;

  const provider = PROVIDER_MAP[providerId];
  const route = await resolveRoute(providerId);
  const system = buildSystemPrompt({
    providerId,
    providerName: provider.name,
    persona,
    roomName,
    topic,
    roster,
    onlineHumans,
    lastHumanName,
  });
  const turns = historyToTurns(history, providerId);

  const [row] = await db
    .insert(messages)
    .values({
      roomId,
      authorId: providerId,
      authorKind: "ai",
      authorName: provider.name,
      content: "",
      status: "pending",
      provider: providerId,
      model: route.model,
      transport: route.transport,
    })
    .returning({ id: messages.id });

  const messageId = row.id;
  const startedAt = Date.now();

  try {
    await delay(startDelayMs);
    await db
      .update(messages)
      .set({ status: "streaming", updatedAt: new Date() })
      .where(eq(messages.id, messageId));

    let buffer = "";
    let lastFlush = 0;

    for await (const chunk of streamChat({
      transport: route.transport,
      model: route.model,
      apiKey: route.apiKey,
      baseUrl: route.baseUrl,
      system,
      history: turns,
      temperature: 0.8,
      maxTokens: 600,
    })) {
      buffer += chunk;
      const now = Date.now();
      if (now - lastFlush > 90) {
        lastFlush = now;
        await db
          .update(messages)
          .set({ content: buffer, status: "streaming", updatedAt: new Date() })
          .where(eq(messages.id, messageId));
      }
    }

    await db
      .update(messages)
      .set({
        content: buffer.trim() || "(üres válasz)",
        status: "done",
        latencyMs: Date.now() - startedAt,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, messageId));

    return { id: messageId, providerId, ok: true, length: buffer.trim().length };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await db
      .update(messages)
      .set({
        content: `⚠️ ${provider.name} nem tudott válaszolni: ${detail.slice(0, 300)}`,
        status: "error",
        latencyMs: Date.now() - startedAt,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, messageId));
    return { id: messageId, providerId, ok: false, length: 0 };
  }
}

export async function dispatchReplies(options: {
  roomId: string;
  triggerMessageId?: string;
  only?: ProviderId[];
  depth?: number;
}) {
  const { roomId, triggerMessageId, only, depth = 0 } = options;
  const key = `${roomId}:${triggerMessageId ?? "manual"}:${depth}:${only?.join(",") ?? "auto"}`;
  if (inflight.has(key)) return;
  inflight.add(key);

  try {
    const room = await getRoom(roomId);
    if (!room) return;

    const participants = await buildParticipants(roomId);
    const enabled = participants.filter((p) => p.enabled).map((p) => p.id);
    if (enabled.length === 0) return;

    const history = await getRecentMessages(roomId, 24);
    const trigger = history.find((row) => row.id === triggerMessageId) ?? history[history.length - 1];
    if (!trigger) return;

    const [onlineHumans, rosterNames] = await Promise.all([
      getOnlineHumans(roomId).then((list) => list.map((h) => h.name)),
      Promise.resolve(participants.filter((p) => p.enabled).map((p) => p.name)),
    ]);

    const lastHuman = [...history].reverse().find((row) => row.authorKind === "human");

    const responders = only
      ? only.filter((id) => enabled.includes(id))
      : selectResponders(trigger.content, room.autoMode, enabled, history.length);

    if (responders.length === 0) {
      await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, roomId));
      return;
    }

    const personaById = new Map(participants.map((p) => [p.id, p.persona]));

    const results = await Promise.all(
      responders.map((providerId, index) =>
        runReply({
          roomId,
          roomName: room.name,
          topic: room.topic,
          providerId,
          persona: personaById.get(providerId) ?? PROVIDER_MAP[providerId].persona,
          history,
          onlineHumans: onlineHumans.length > 0 ? onlineHumans : ["Vendég"],
          lastHumanName: lastHuman?.authorName ?? "Valaki",
          roster: rosterNames,
          startDelayMs: index * 420,
        }),
      ),
    );

    await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, roomId));

    // Cross-talk: let one other model react to the answers above.
    if (room.crossTalk && depth === 0 && responders.length > 0) {
      const others = enabled.filter((id) => !responders.includes(id));
      if (others.length > 0 && Math.random() < 0.55) {
        const candidate = others[Math.floor(Math.random() * others.length)];
        await delay(500);
        await dispatchReplies({
          roomId,
          triggerMessageId: results[results.length - 1]?.id ?? triggerMessageId,
          only: [candidate],
          depth: depth + 1,
        });
      }
    }
  } catch (error) {
    console.error("dispatch error", error);
  } finally {
    inflight.delete(key);
  }
}

export async function setParticipantEnabled(roomId: string, participantId: ProviderId, enabled: boolean) {
  await db
    .update(roomParticipants)
    .set({ enabled })
    .where(
      and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.participantId, participantId),
      ),
    );
}

export async function setRoomSettings(
  roomId: string,
  settings: { name?: string; topic?: string; autoMode?: string; crossTalk?: boolean },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof settings.name === "string" && settings.name.trim()) patch.name = settings.name.trim().slice(0, 60);
  if (typeof settings.topic === "string") patch.topic = settings.topic.trim().slice(0, 400);
  if (typeof settings.autoMode === "string") patch.autoMode = settings.autoMode;
  if (typeof settings.crossTalk === "boolean") patch.crossTalk = settings.crossTalk;

  await db.update(rooms).set(patch).where(eq(rooms.id, roomId));
}

export async function deleteMessage(messageId: string) {
  await db.delete(messages).where(eq(messages.id, messageId));
}
