import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { isProviderId, type ProviderId } from "@/lib/ai/providers";
import { dispatchReplies } from "@/lib/chat/dispatch";
import { getRoom, getRoomState, heartbeat, toMessageDto } from "@/lib/chat/data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    content?: string;
    author?: string;
    targets?: string[];
  };
  const content = (body.content ?? "").trim();
  const author = (body.author ?? "").trim().slice(0, 32) || "Vendég";

  if (!content) {
    return Response.json({ error: "Az üzenet nem lehet üres." }, { status: 400 });
  }

  const room = await getRoom(id);
  if (!room) return Response.json({ error: "A szoba nem található." }, { status: 404 });

  const [row] = await db
    .insert(messages)
    .values({
      roomId: id,
      authorId: `human:${author.toLowerCase()}`,
      authorKind: "human",
      authorName: author,
      content: content.slice(0, 4000),
      status: "done",
    })
    .returning();

  await heartbeat(id, author);
  await db.update(messages).set({ updatedAt: new Date() }).where(eq(messages.id, row.id));

  const targets = (body.targets ?? []).filter(isProviderId) as ProviderId[];

  after(async () => {
    await dispatchReplies({
      roomId: id,
      triggerMessageId: row.id,
      only: targets.length > 0 ? targets : undefined,
    });
  });

  return Response.json({ message: toMessageDto(row) }, { status: 201 });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const messageId = new URL(request.url).searchParams.get("messageId");
  if (!messageId) return Response.json({ error: "messageId kötelező." }, { status: 400 });

  await db.delete(messages).where(eq(messages.id, messageId));
  const state = await getRoomState(id);
  return Response.json(state ?? { error: "A szoba nem található." }, { status: state ? 200 : 404 });
}
