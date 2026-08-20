import { createRoom, listRooms } from "@/lib/chat/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const roomList = await listRooms();
  return Response.json({ rooms: roomList });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string; topic?: string };
  const name = (body.name ?? "").trim();
  if (!name) {
    return Response.json({ error: "A szoba neve kötelező." }, { status: 400 });
  }
  const id = await createRoom(name, body.topic ?? "");
  return Response.json({ id }, { status: 201 });
}
