import { heartbeat } from "@/lib/chat/data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { roomId?: string; name?: string };
  if (!body.roomId || !body.name) {
    return Response.json({ error: "roomId és name kötelező." }, { status: 400 });
  }
  await heartbeat(body.roomId, body.name.trim().slice(0, 32));
  return Response.json({ ok: true });
}
