"use client";

import { useState } from "react";
import type { MessageDto, ParticipantDto } from "@/lib/chat/data";

const PROVIDER_LOOK: Record<string, { accent: string; ring: string; emoji: string }> = {
  chatgpt: { accent: "from-emerald-500 to-teal-500", ring: "ring-emerald-400/40", emoji: "🟢" },
  copilot: { accent: "from-sky-500 to-blue-600", ring: "ring-sky-400/40", emoji: "🔷" },
  gemini: { accent: "from-blue-400 to-fuchsia-500", ring: "ring-fuchsia-400/40", emoji: "✨" },
  perplexity: { accent: "from-teal-400 to-cyan-600", ring: "ring-cyan-400/40", emoji: "🟣" },
  claude: { accent: "from-orange-400 to-amber-600", ring: "ring-amber-400/40", emoji: "🟠" },
};

function renderInline(text: string, keyPrefix: string) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return (
        <code key={key} className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-200">
          {token.slice(1, -1)}
        </code>
      );
    }
    return <span key={key}>{token}</span>;
  });
}

function MessageBody({ content }: { content: string }) {
  const blocks = content.split(/```/);
  return (
    <div className="space-y-2 text-[0.94rem] leading-relaxed break-words">
      {blocks.map((block, blockIndex) => {
        if (blockIndex % 2 === 1) {
          return (
            <pre
              key={`code-${blockIndex}`}
              className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs text-cyan-100"
            >
              {block.replace(/^\w+\n/, "").trimEnd()}
            </pre>
          );
        }
        return block.split("\n").map((line, lineIndex) => {
          const key = `l-${blockIndex}-${lineIndex}`;
          if (!line.trim()) return <div key={key} className="h-1.5" />;
          const isBullet = /^\s*([-*•]|\d+\.)\s+/.test(line);
          if (isBullet) {
            return (
              <div key={key} className="flex gap-2 pl-1">
                <span className="text-white/40">•</span>
                <span>{renderInline(line.replace(/^\s*([-*•]|\d+\.)\s+/, ""), key)}</span>
              </div>
            );
          }
          return <p key={key}>{renderInline(line, key)}</p>;
        });
      })}
    </div>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

export default function MessageBubble({
  message,
  participant,
  onRegenerate,
}: {
  message: MessageDto;
  participant?: ParticipantDto;
  onRegenerate?: (message: MessageDto) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHuman = message.authorKind === "human";
  const isSystem = message.authorKind === "system";
  const isAi = message.authorKind === "ai";
  const look = isAi
    ? PROVIDER_LOOK[message.authorId] ?? { accent: "from-slate-500 to-slate-700", ring: "ring-white/20", emoji: "🤖" }
    : null;

  if (isSystem) {
    return (
      <div className="mx-auto max-w-2xl rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-center text-xs text-slate-300">
        {message.content}
      </div>
    );
  }

  const streaming = message.status === "streaming" || message.status === "pending";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`group flex gap-3 ${isHuman ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-lg ${
          look?.accent ?? "from-indigo-500 to-violet-600"
        } ${isAi ? look?.ring : ""} ring-1`}
      >
        {isHuman ? message.authorName.slice(0, 2).toUpperCase() : look?.emoji ?? "🤖"}
      </div>

      <div className={`flex max-w-[min(46rem,88%)] flex-col ${isHuman ? "items-end" : "items-start"}`}>
        <div className="mb-1 flex items-center gap-2 text-[0.7rem] text-slate-400">
          <span className="font-semibold text-slate-200">{message.authorName}</span>
          {isAi && participant && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[0.65rem] text-slate-300">
              {message.model ?? participant.model}
              {participant.transport === "demo" ? " · demo" : ""}
            </span>
          )}
          {isAi && message.latencyMs ? (
            <span className="hidden sm:inline">{(message.latencyMs / 1000).toFixed(1)}s</span>
          ) : null}
          <span>{formatTime(message.createdAt)}</span>
        </div>

        <div
          className={`rounded-2xl px-4 py-3 shadow-lg backdrop-blur ${
            isHuman
              ? "bg-gradient-to-br from-indigo-600 to-violet-700 text-white"
              : message.status === "error"
                ? "border border-rose-500/40 bg-rose-950/40 text-rose-100"
                : "border border-white/10 bg-white/[0.07] text-slate-100"
          }`}
        >
          {message.status === "pending" ? (
            <span className="flex items-center gap-1.5 text-sm text-slate-300">
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.1s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
              <span className="ml-1 text-xs">gépel…</span>
            </span>
          ) : (
            <>
              <MessageBody content={message.content} />
              {message.status === "streaming" ? (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-cyan-300 align-middle" />
              ) : null}
            </>
          )}
        </div>

        {!streaming && (
          <div className="mt-1 flex gap-2 text-[0.7rem] text-slate-400 opacity-0 transition group-hover:opacity-100">
            <button type="button" onClick={copy} className="hover:text-white">
              {copied ? "✓ másolva" : "másolás"}
            </button>
            {isAi && onRegenerate ? (
              <button type="button" onClick={() => onRegenerate(message)} className="hover:text-white">
                újragenerálás
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
