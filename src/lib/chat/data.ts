import { and, asc, desc, eq, gt, gte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { messages, presence, roomParticipants, rooms } from "@/db/schema";
import { PROVIDERS, type ProviderId } from "@/lib/ai/providers";
import { resolveRoutes, type ResolvedRoute } from "@/lib/ai/keys";

export const AUTO_MODES = ["all", "mentioned", "random", "round_robin", "off"] as const;
export type AutoMode = (typeof AUTO_MODES)[number];

export type MessageDto = {
  id: string;
  roomId: string;
  authorId: string;
  authorKind: "human" | "ai" | "system";
  authorName: string;
  content: string;
  status: string;
  provider: string | null;
  model: string | null;
  transport: string | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ParticipantDto = {
  id: ProviderId;
  name: string;
  shortName: string;
  emoji: string;
  accent: string;
  tagline: string;
  enabled: boolean;
  persona: string;
  model: string;
  transport: string;
  live: boolean;
};

export type RoomDto = {
  id: string;
  name: string;
  topic: string;
  autoMode: string;
  crossTalk: boolean;
  messageCount: number;
  updatedAt: string;
};

export type HumanDto = { name: string; lastSeenAt: string };

export type RoomStateDto = {
  room: RoomDto;
  participants: ParticipantDto[];
  messages: MessageDto[];
  humans: HumanDto[];
};

function toMessageDto(row: typeof messages.$inferSelect): MessageDto {
  return {
    id: row.id,
    roomId: row.roomId,
    authorId: row.authorId,
    authorKind: (row.authorKind as MessageDto["authorKind"]) ?? "human",
    authorName: row.authorName,
    content: row.content,
    status: row.status,
    provider: row.provider,
    model: row.model,
    transport: row.transport,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureDefaultRoom(): Promise<string> {
  const existing = await db.select({ id: rooms.id }).from(rooms).orderBy(asc(rooms.createdAt)).limit(1);
  if (existing.length > 0) return existing[0].id;

  const [room] = await db
    .insert(rooms)
    .values({
      name: "AI Klub 🤖",
      topic: "Kerekasztal: öt ember és öt AI egy szobában. Kérdezz bármit, ők valós időben válaszolnak.",
    })
    .returning({ id: rooms.id });

  await db.insert(roomParticipants).values(
    PROVIDERS.map((provider) => ({
      roomId: room.id,
      participantId: provider.id,
      enabled: true,
      persona: provider.persona,
    })),
  );

  await db.insert(messages).values({
    roomId: room.id,
    authorId: "system",
    authorKind: "system",
    authorName: "Rendszer",
    content:
      "Üdv a csoportos AI chatben! Írj egy üzenetet, és a bekapcsolt AI-ok valós időben válaszolnak. Használj @említést, ha csak egyikkel szeretnél beszélni.",
    status: "done",
  });

  return room.id;
}

export async function listRooms(): Promise<RoomDto[]> {
  await ensureDefaultRoom();
  const rows = await db
    .select({
      id: rooms.id,
      name: rooms.name,
      topic: rooms.topic,
      autoMode: rooms.autoMode,
      crossTalk: rooms.crossTalk,
      updatedAt: rooms.updatedAt,
      messageCount: sql<number>`(select count(*)::int from ${messages} where ${messages.roomId} = ${rooms.id})`,
    })
    .from(rooms)
    .orderBy(asc(rooms.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    topic: row.topic,
    autoMode: row.autoMode,
    crossTalk: row.crossTalk,
    messageCount: Number(row.messageCount ?? 0),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createRoom(name: string, topic: string): Promise<string> {
  const [room] = await db
    .insert(rooms)
    .values({
      name: name.trim().slice(0, 60) || "Új szoba",
      topic: topic.trim().slice(0, 400),
    })
    .returning({ id: rooms.id });

  await db.insert(roomParticipants).values(
    PROVIDERS.map((provider) => ({
      roomId: room.id,
      participantId: provider.id,
      enabled: true,
      persona: provider.persona,
    })),
  );

  await db.insert(messages).values({
    roomId: room.id,
    authorId: "system",
    authorKind: "system",
    authorName: "Rendszer",
    content: `Szoba létrehozva: ${name.trim()}. Kezdheted a beszélgetést!`,
    status: "done",
  });

  return room.id;
}

export async function getRoom(roomId: string) {
  const rows = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  return rows[0] ?? null;
}

export async function buildParticipants(
  roomId: string,
  routes?: Record<ProviderId, ResolvedRoute>,
): Promise<ParticipantDto[]> {
  const [rows, routeMap] = await Promise.all([
    db.select().from(roomParticipants).where(eq(roomParticipants.roomId, roomId)),
    routes ? Promise.resolve(routes) : resolveRoutes(),
  ]);

  const byId = new Map(rows.map((row) => [row.participantId, row]));

  return PROVIDERS.map((provider) => {
    const row = byId.get(provider.id);
    const route = routeMap[provider.id];
    return {
      id: provider.id,
      name: provider.name,
      shortName: provider.shortName,
      emoji: provider.emoji,
      accent: provider.accent,
      tagline: provider.tagline,
      enabled: row?.enabled ?? true,
      persona: row?.persona ?? provider.persona,
      model: route?.model ?? provider.defaultModel,
      transport: route?.transport ?? "demo",
      live: (route?.transport ?? "demo") !== "demo",
    };
  });
}

export async function getRoomState(roomId: string): Promise<RoomStateDto | null> {
  const room = await getRoom(roomId);
  if (!room) return null;

  const [participants, messageRows, humanRows, countRows] = await Promise.all([
    buildParticipants(roomId),
    db.select().from(messages).where(eq(messages.roomId, roomId)).orderBy(asc(messages.createdAt)).limit(300),
    db
      .select()
      .from(presence)
      .where(
        and(
          eq(presence.roomId, roomId),
          gt(presence.lastSeenAt, new Date(Date.now() - 60_000)),
        ),
      )
      .orderBy(asc(presence.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(messages).where(eq(messages.roomId, roomId)),
  ]);

  return {
    room: {
      id: room.id,
      name: room.name,
      topic: room.topic,
      autoMode: room.autoMode,
      crossTalk: room.crossTalk,
      messageCount: Number(countRows[0]?.count ?? 0),
      updatedAt: room.updatedAt.toISOString(),
    },
    participants,
    messages: messageRows.map(toMessageDto),
    humans: humanRows.map((row) => ({ name: row.name, lastSeenAt: row.lastSeenAt.toISOString() })),
  };
}

export async function getMessagesSince(
  roomId: string,
  since: Date,
): Promise<MessageDto[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.roomId, roomId), or(gt(messages.createdAt, since), gt(messages.updatedAt, since))))
    .orderBy(asc(messages.createdAt))
    .limit(120);
  return rows.map(toMessageDto);
}

export async function getRecentMessages(roomId: string, limit = 24) {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.roomId, roomId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function heartbeat(roomId: string, name: string) {
  const clean = name.trim().slice(0, 32) || "Vendég";
  const existing = await db
    .select()
    .from(presence)
    .where(and(eq(presence.roomId, roomId), eq(presence.name, clean)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(presence)
      .set({ lastSeenAt: new Date() })
      .where(eq(presence.id, existing[0].id));
    return;
  }

  await db.insert(presence).values({ roomId, name: clean });
}

export async function getOnlineHumans(roomId: string): Promise<HumanDto[]> {
  const rows = await db
    .select()
    .from(presence)
    .where(
      and(eq(presence.roomId, roomId), gte(presence.lastSeenAt, new Date(Date.now() - 60_000))),
    )
    .orderBy(asc(presence.name));
  return rows.map((row) => ({ name: row.name, lastSeenAt: row.lastSeenAt.toISOString() }));
}

export function extractMentions(content: string): ProviderId[] {
  const found = new Set<ProviderId>();
  const lower = content.toLowerCase();
  for (const provider of PROVIDERS) {
    const needles = [`@${provider.id}`, `@${provider.name.toLowerCase()}`, `@${provider.shortName.toLowerCase()}`];
    if (needles.some((needle) => lower.includes(needle))) {
      found.add(provider.id);
    }
  }
  return [...found];
}

export function buildSystemPrompt(options: {
  providerId: ProviderId;
  providerName: string;
  persona: string;
  roomName: string;
  topic: string;
  roster: string[];
  onlineHumans: string[];
  lastHumanName: string;
}): string {
  return [
    `Egy valós idejű CSOPORTOS chatben veszel részt, a szoba neve: "${options.roomName}".`,
    options.topic ? `A szoba témája: ${options.topic}` : "",
    `A résztvevők: emberek (${options.onlineHumans.join(", ") || "ismeretlen"}) és AI-asszisztensek (${options.roster.join(", ")}).`,
    `TE ${options.providerName} vagy. Személyiséged: ${options.persona}`,
    `A legutóbbi emberi üzenet írója: ${options.lastHumanName}.`,
    "Szabályok:",
    "- Válaszolj annak a nyelvén, amelyen az utolsó üzenet íródott (alapértelmezetten magyarul).",
    "- Rövid, beszélgetős stílus: 1-4 mondat, max. ~80 szó. Ne írj esszét, ne használj felesleges címeket.",
    "- Ha egy másik AI már válaszolt, reagálhatsz rá: ért egyet, vitatkozz, vagy tegyél hozzá valamit. Ne ismételd szó szerint, amit más mondott.",
    "- Ha kérdeznek, adj konkrét, használható választ. Szívesen mondd ki, ha valamiben nem vagy biztos.",
    "- Ne töltsd ki más AI nevében a választ, és ne írj két azonos hozzászólást.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function historyToTurns(
  rows: Array<typeof messages.$inferSelect>,
  selfId: string,
): { role: "user" | "assistant"; content: string }[] {
  const turns = rows
    .filter((row) => row.status !== "error" && row.content.trim().length > 0)
    .slice(-16)
    .map((row) => {
      const isSelf = row.authorId === selfId;
      const label = row.authorKind === "human" ? row.authorName : row.authorName;
      return {
        role: (isSelf ? "assistant" : "user") as "assistant" | "user",
        content: isSelf ? row.content : `${label}: ${row.content}`,
      };
    });

  if (turns.length === 0) {
    return [{ role: "user", content: "Üdv a szobában! Írj pár szót magadról." }];
  }
  return turns;
}

export { toMessageDto };
