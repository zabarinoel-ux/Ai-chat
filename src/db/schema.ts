import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  topic: text("topic").notNull().default(""),
  language: text("language").notNull().default("hu"),
  autoMode: text("auto_mode").notNull().default("all"),
  crossTalk: boolean("cross_talk").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roomParticipants = pgTable(
  "room_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    participantId: text("participant_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    persona: text("persona").notNull().default(""),
  },
  (table) => [
    uniqueIndex("room_participants_room_participant_idx").on(table.roomId, table.participantId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    authorKind: text("author_kind").notNull().default("human"),
    authorName: text("author_name").notNull(),
    content: text("content").notNull().default(""),
    status: text("status").notNull().default("done"),
    provider: text("provider"),
    model: text("model"),
    transport: text("transport"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_room_created_idx").on(table.roomId, table.createdAt)],
);

export const providerKeys = pgTable(
  "provider_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    apiKey: text("api_key").notNull().default(""),
    model: text("model").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("provider_keys_provider_idx").on(table.provider)],
);

export const presence = pgTable(
  "presence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("presence_room_name_idx").on(table.roomId, table.name)],
);

export type Room = typeof rooms.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type RoomParticipant = typeof roomParticipants.$inferSelect;
