import { getRoomState } from "@/lib/chat/data";
import { setRoomSettings } from "@/lib/chat/dispatch";
import { AUTO_MODES } from "@/lib/chat/data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const state = await getRoomState(id);
  if (!state) return Response.json({ error: "A szoba nem található." }, { status: 404 });
  return Response.json(state);
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    topic?: string;
    autoMode?: string;
    crossTalk?: boolean;
  };

  if (body.autoMode && !AUTO_MODES.includes(body.autoMode as (typeof AUTO_MODES)[number])) {
    return Response.json({ error: "Ismeretlen válaszmód." }, { status: 400 });
  }

  await setRoomSettings(id, body);
  const state = await getRoomState(id);
  if (!state) return Response.json({ error: "A szoba nem található." }, { status: 404 });
  return Response.json(state);
}
