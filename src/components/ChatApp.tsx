"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Composer from "@/components/Composer";
import MessageBubble from "@/components/MessageBubble";
import SettingsModal from "@/components/SettingsModal";
import type { HumanDto, MessageDto, ParticipantDto, RoomDto, RoomStateDto } from "@/lib/chat/data";

const AUTO_MODE_LABELS: Record<string, string> = {
  all: "Mindenki válaszol",
  mentioned: "Csak @említésre",
  random: "1-2 véletlen",
  round_robin: "Sorrendben egy",
  off: "AI válasz kikapcsolva",
};

const NICK_KEY = "ai-group-chat:nickname";

function randomNickname() {
  return `Vendég-${Math.floor(100 + Math.random() * 900)}`;
}

export default function ChatApp({ initialState, rooms: initialRooms }: { initialState: RoomStateDto; rooms: RoomDto[] }) {
  const [rooms, setRooms] = useState<RoomDto[]>(initialRooms);
  const [state, setState] = useState<RoomStateDto>(initialState);
  const [nickname, setNickname] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sinceRef = useRef<string>(new Date().toISOString());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const roomId = state.room.id;

  const mergeMessages = useCallback((incoming: MessageDto[]) => {
    if (incoming.length === 0) return;
    setState((prev) => {
      const map = new Map(prev.messages.map((message) => [message.id, message]));
      for (const message of incoming) map.set(message.id, message);
      const merged = [...map.values()].sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
      const newest = incoming
        .map((message) => new Date(message.updatedAt).getTime())
        .reduce((max, value) => Math.max(max, value), 0);
      const since = new Date(sinceRef.current).getTime();
      if (newest > since) sinceRef.current = new Date(newest + 1).toISOString();
      return { ...prev, messages: merged.slice(-400) };
    });
  }, []);

  /* ---------- nickname ---------- */
  useEffect(() => {
    const stored = window.localStorage.getItem(NICK_KEY);
    const value = stored && stored.trim() ? stored : randomNickname();
    setNickname(value);
  }, []);

  useEffect(() => {
    if (!nickname) return;
    window.localStorage.setItem(NICK_KEY, nickname);
  }, [nickname]);

  /* ---------- real-time stream ---------- */
  useEffect(() => {
    let cancelled = false;

    const handleFrame = (event: string, payload: unknown) => {
      if (event === "messages") mergeMessages(payload as MessageDto[]);
      if (event === "humans") setState((prev) => ({ ...prev, humans: payload as HumanDto[] }));
      if (event === "bye") setConnected(false);
    };

    const run = async () => {
      while (!cancelled) {
        try {
          setConnected(true);
          const response = await fetch(`/api/rooms/${roomId}/stream?since=${encodeURIComponent(sinceRef.current)}`);
          if (!response.ok || !response.body) throw new Error("stream unavailable");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const lines = frame.split("\n");
              const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
              const dataLine = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
              if (!eventName || !dataLine) continue;
              try {
                handleFrame(eventName, JSON.parse(dataLine));
              } catch {
                // ignore malformed frame
              }
            }
          }
        } catch {
          setConnected(false);
        }
        if (cancelled) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [roomId, mergeMessages]);

  /* ---------- presence heartbeat ---------- */
  useEffect(() => {
    if (!nickname) return;
    const beat = () => {
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, name: nickname }),
      }).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, 20_000);
    return () => clearInterval(timer);
  }, [roomId, nickname]);

  /* ---------- autoscroll ---------- */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [state.messages]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 140;
  };

  /* ---------- actions ---------- */
  const refreshRooms = async () => {
    const response = await fetch("/api/rooms");
    const data = (await response.json()) as { rooms: RoomDto[] };
    setRooms(data.rooms ?? []);
  };

  const switchRoom = async (id: string) => {
    stickRef.current = true;
    setSidebarOpen(false);
    sinceRef.current = new Date().toISOString();
    const response = await fetch(`/api/rooms/${id}`);
    if (!response.ok) return;
    const next = (await response.json()) as RoomStateDto;
    const newest = next.messages.reduce(
      (max, message) => Math.max(max, new Date(message.updatedAt).getTime()),
      Date.now(),
    );
    sinceRef.current = new Date(newest + 1).toISOString();
    setState(next);
    setTargets([]);
    void refreshRooms();
  };

  const sendMessage = async (content: string, chosenTargets: string[]) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, author: nickname || "Vendég", targets: chosenTargets }),
      });
      const data = (await response.json()) as { message?: MessageDto; error?: string };
      if (data.message) mergeMessages([data.message]);
      if (data.error) setNotice(data.error);
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (message: MessageDto) => {
    await fetch(`/api/rooms/${roomId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate", messageId: message.id }),
    }).catch(() => undefined);
  };

  const askEveryone = async () => {
    const enabled = state.participants.filter((p) => p.enabled).map((p) => p.id);
    if (enabled.length === 0) return;
    await fetch(`/api/rooms/${roomId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participants: enabled, author: nickname }),
    }).catch(() => undefined);
  };

  const toggleParticipant = async (id: string, enabled: boolean) => {
    const response = await fetch(`/api/rooms/${roomId}/participants`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: id, enabled }),
    });
    if (!response.ok) return;
    const next = (await response.json()) as RoomStateDto;
    setState((prev) => ({ ...next, messages: prev.messages, humans: prev.humans }));
  };

  const patchRoom = async (patch: Record<string, unknown>) => {
    const response = await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return;
    const next = (await response.json()) as RoomStateDto;
    setState((prev) => ({ ...next, messages: prev.messages, humans: prev.humans }));
    void refreshRooms();
  };

  const createRoom = async () => {
    const name = newRoomName.trim();
    if (!name) return;
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, topic: state.room.topic }),
    });
    const data = (await response.json()) as { id?: string };
    setNewRoomName("");
    if (data.id) await switchRoom(data.id);
  };

  /* ---------- derived ---------- */
  const typing = useMemo(() => {
    const active = new Set<string>();
    for (const message of state.messages) {
      if (message.status === "pending" || message.status === "streaming") active.add(message.authorId);
    }
    return [...active];
  }, [state.messages]);

  const liveCount = state.participants.filter((p) => p.enabled && p.live).length;
  const demoCount = state.participants.filter((p) => p.enabled && !p.live).length;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Sidebar */}
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Menü bezárása"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      ) : null}

      <aside
        className={`${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-white/10 bg-slate-950/95 p-4 backdrop-blur-xl transition-transform duration-200 md:relative md:translate-x-0 md:bg-slate-950/80 md:backdrop-blur-none`}
      >
        <div className="mb-4">
          <h1 className="text-lg font-bold tracking-tight text-white">🤖 AI Klub</h1>
          <p className="text-xs text-slate-400">Csoportos chat 5 AI-val, valós időben</p>
        </div>

        <label className="mb-1 text-[0.68rem] uppercase tracking-wide text-slate-500">A neved</label>
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value.slice(0, 32))}
          className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 focus:border-indigo-400/50 focus:outline-none"
        />

        <div className="mb-3 flex items-center justify-between">
          <span className="text-[0.68rem] uppercase tracking-wide text-slate-500">Szobák</span>
          <span className={`text-[0.68rem] ${connected ? "text-emerald-400" : "text-amber-400"}`}>
            {connected ? "● élő" : "○ újrakapcsolódás"}
          </span>
        </div>
        <div className="mb-2 space-y-1">
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => void switchRoom(room.id)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                room.id === roomId
                  ? "bg-gradient-to-r from-indigo-500/25 to-violet-500/15 ring-1 ring-indigo-400/40"
                  : "bg-white/[0.03] hover:bg-white/[0.07]"
              }`}
            >
              <span className="block truncate font-medium text-slate-100">{room.name}</span>
              <span className="text-[0.65rem] text-slate-500">{room.messageCount} üzenet</span>
            </button>
          ))}
        </div>
        <div className="mb-5 flex gap-2">
          <input
            value={newRoomName}
            onChange={(event) => setNewRoomName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createRoom();
            }}
            placeholder="új szoba neve"
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void createRoom()}
            className="rounded-xl bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/20"
          >
            +
          </button>
        </div>

        <div className="mb-3 text-[0.68rem] uppercase tracking-wide text-slate-500">AI résztvevők</div>
        <div className="space-y-1.5">
          {state.participants.map((participant) => (
            <div
              key={participant.id}
              className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition ${
                participant.enabled ? "bg-white/[0.05]" : "bg-transparent opacity-50"
              }`}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-100">
                  <span>{participant.emoji}</span>
                  {participant.name}
                  {typing.includes(participant.id) ? (
                    <span className="ml-1 animate-pulse text-[0.6rem] font-normal text-cyan-300">gépel…</span>
                  ) : null}
                </p>
                <p className="truncate text-[0.62rem] text-slate-500">
                  {participant.live ? participant.model : "demo mód"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggleParticipant(participant.id, !participant.enabled)}
                className={`h-5 w-9 shrink-0 rounded-full transition ${participant.enabled ? "bg-emerald-500/80" : "bg-slate-600"}`}
              >
                <span
                  className={`block h-4 w-4 translate-y-[2px] rounded-full bg-white transition ${
                    participant.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-auto pt-4">
          <div className="mb-3">
            <div className="mb-1 text-[0.68rem] uppercase tracking-wide text-slate-500">Online emberek</div>
            <div className="flex flex-wrap gap-1.5">
              {state.humans.length === 0 ? (
                <span className="text-xs text-slate-500">még senki…</span>
              ) : (
                state.humans.map((human) => (
                  <span
                    key={human.name}
                    className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.68rem] text-emerald-200 ring-1 ring-emerald-400/20"
                  >
                    {human.name}
                  </span>
                ))
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.08]"
          >
            🔑 API kulcsok ·{" "}
            <span className={liveCount > 0 ? "text-emerald-300" : "text-amber-300"}>
              {liveCount} élő / {demoCount} demo
            </span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(99,102,241,0.18),transparent)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 md:hidden"
              aria-label="Menü"
            >
              ☰
            </button>
            <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-white sm:text-lg">{state.room.name}</h2>
            <p className="truncate text-xs text-slate-400">{state.room.topic || "Nincs téma megadva."}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/5 px-3 py-1 text-[0.68rem] text-slate-300">
              {AUTO_MODE_LABELS[state.room.autoMode] ?? state.room.autoMode}
            </span>
            <button
              type="button"
              onClick={() => void askEveryone()}
              className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-900/30 hover:brightness-110"
            >
              Kérdezd meg mindet
            </button>
            <button
              type="button"
              onClick={() => setShowRoomSettings((prev) => !prev)}
              className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            >
              ⚙️ szoba
            </button>
          </div>

          {showRoomSettings ? (
            <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Szoba neve
                  <input
                    defaultValue={state.room.name}
                    onBlur={(event) => void patchRoom({ name: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400/50 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Téma / kontextus
                  <input
                    defaultValue={state.room.topic}
                    onBlur={(event) => void patchRoom({ topic: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400/50 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Ki válaszol automatikusan?
                  <select
                    value={state.room.autoMode}
                    onChange={(event) => void patchRoom({ autoMode: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400/50 focus:outline-none"
                  >
                    {Object.entries(AUTO_MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value} className="bg-slate-900">
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={state.room.crossTalk}
                    onChange={(event) => void patchRoom({ crossTalk: event.target.checked })}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  Az AI-ok reagálhatnak egymásra (cross-talk)
                </label>
              </div>
            </div>
          ) : null}
        </header>

        {notice ? (
          <div className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">
            {notice}
          </div>
        ) : null}

        {demoCount > 0 && liveCount === 0 ? (
          <div className="border-b border-amber-400/20 bg-amber-500/[0.07] px-4 py-2 text-center text-[0.72rem] text-amber-200">
            Demo mód: még nincs API kulcs bekötve, a modellek a beépített agyval válaszolnak. Add meg a kulcsaidat a
            bal alsó „API kulcsok” gombbal, és azonnal élő válaszokat kapsz.
          </div>
        ) : null}

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-3 py-5 sm:px-6">
          {state.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              participant={state.participants.find((p) => p.id === message.authorId)}
              onRegenerate={(message) => void regenerate(message)}
            />
          ))}
        </div>

        <Composer
          participants={state.participants}
          nickname={nickname}
          targets={targets}
          onToggleTarget={(id) =>
            setTargets((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
          }
          onClearTargets={() => setTargets([])}
          onSend={sendMessage}
          busy={busy}
        />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChanged={() => void refreshRooms()} />
    </div>
  );
}


