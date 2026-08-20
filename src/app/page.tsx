import ChatApp from "@/components/ChatApp";
import { ensureDefaultRoom, getRoomState, listRooms } from "@/lib/chat/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  await ensureDefaultRoom();
  const [rooms, firstRoomId] = await Promise.all([
    listRooms().then((list) => list),
    ensureDefaultRoom(),
  ]);
  const state = await getRoomState(firstRoomId);

  if (!state) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-950 text-slate-200">
        <p>Nem sikerült betölteni a szobát.</p>
      </main>
    );
  }

  return <ChatApp initialState={state} rooms={rooms} />;
}
