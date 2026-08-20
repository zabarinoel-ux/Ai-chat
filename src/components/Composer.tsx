"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantDto } from "@/lib/chat/data";

export default function Composer({
  participants,
  nickname,
  targets,
  onToggleTarget,
  onClearTargets,
  onSend,
  busy,
}: {
  participants: ParticipantDto[];
  nickname: string;
  targets: string[];
  onToggleTarget: (id: string) => void;
  onClearTargets: () => void;
  onSend: (content: string, targets: string[]) => Promise<void>;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const enabled = useMemo(() => participants.filter((p) => p.enabled), [participants]);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return enabled.filter(
      (p) => p.id.includes(query) || p.name.toLowerCase().includes(query) || p.shortName.toLowerCase().includes(query),
    );
  }, [enabled, mentionQuery]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  const detectMention = (text: string, caret: number) => {
    const upToCaret = text.slice(0, caret);
    const match = upToCaret.match(/@([\w-]*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const applyMention = (id: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\w-]*)$/, `@${id} `);
    const next = `${before}${value.slice(caret)}`;
    setValue(next);
    setMentionQuery(null);
    onToggleTarget(id);
    requestAnimationFrame(() => textarea.focus());
  };

  const submit = async () => {
    const content = value.trim();
    if (!content || busy) return;
    setValue("");
    setMentionQuery(null);
    await onSend(content, targets);
  };

  return (
    <div className="border-t border-white/10 bg-slate-950/70 px-3 py-3 backdrop-blur-xl sm:px-6">
      {mentionQuery !== null && suggestions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-slate-900/90 p-2">
          {suggestions.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyMention(p.id)}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/15"
            >
              <span>{p.emoji}</span>
              <span className="font-medium">{p.name}</span>
              <span className="font-mono text-[0.65rem] text-slate-400">@{p.id}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
        <span className="text-slate-400">Címzettek:</span>
        <button
          type="button"
          onClick={onClearTargets}
          className={`rounded-full px-2.5 py-1 font-medium transition ${
            targets.length === 0
              ? "bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/40"
              : "bg-white/5 text-slate-300 hover:bg-white/10"
          }`}
        >
          auto
        </button>
        {enabled.map((p) => {
          const active = targets.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggleTarget(p.id)}
              className={`rounded-full px-2.5 py-1 font-medium transition ${
                active
                  ? "bg-gradient-to-r from-white/25 to-white/10 text-white ring-1 ring-white/40"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {p.emoji} {p.name}
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-indigo-400/50">
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          onChange={(event) => {
            setValue(event.target.value);
            detectMention(event.target.value, event.target.selectionStart ?? 0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Tab" && mentionQuery !== null && suggestions.length > 0) {
              event.preventDefault();
              applyMention(suggestions[0].id);
            }
            if (event.key === "Escape") setMentionQuery(null);
          }}
          placeholder={`Írj a csoportba, ${nickname || "Vendég"}… (@említés egy AI-nevvel)`}
          className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || value.trim().length === 0}
          className="mb-0.5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "küldés…" : "Küldés"}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[0.68rem] text-slate-500">
        Enter = küldés · Shift+Enter = új sor · @ = AI említés · a „Címzettek” sorral kijelölheted, ki válaszoljon
      </p>
    </div>
  );
}
