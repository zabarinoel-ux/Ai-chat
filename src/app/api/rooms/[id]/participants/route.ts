import { after } from "next/server";
import { isProviderId, type ProviderId } from "@/lib/ai/providers";
import {
  deleteMessage,
  dispatchReplies,
  setParticipantEnabled,
} from "@/lib/chat/dispatch";
import { getRoom, getRoomState } from "@/lib/chat/data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    participantId?: string;
    enabled?: boolean;
  };

  if (!body.participantId || !isProviderId(body.participantId)) {
    return Response.json({ error: "Érvénytelen résztvevő." }, { status: 400 });
  }

  await setParticipantEnabled(id, body.participantId as ProviderId, body.enabled !== false);
  const state = await getRoomState(id);
  return Response.json(state);
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: "ask" | "regenerate";
    participants?: string[];
    prompt?: string;
    author?: string;
    messageId?: string;
  };

  const room = await getRoom(id);
  if (!room) return Response.json({ error: "A szoba nem található." }, { status: 404 });

  if (body.action === "regenerate" && body.messageId) {
    await deleteMessage(body.messageId);
    after(async () => {
      await dispatchReplies({ roomId: id, triggerMessageId: body.messageId, only: undefined });
    });
    return Response.json({ ok: true });
  }

  const requested = (body.participants ?? []).filter(isProviderId) as ProviderId[];
  if (requested.length === 0) {
    return Response.json({ error: "Válassz legalább egy AI-t." }, { status: 400 });
  }

  after(async () => {
    await dispatchReplies({ roomId: id, only: requested, depth: 0 });
  });

  return Response.json({ ok: true, queued: requested.length });
}
