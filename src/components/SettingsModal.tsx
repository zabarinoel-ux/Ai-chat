"use client";

import { useEffect, useState } from "react";

export type KeyStatus = {
  id: string;
  name: string;
  tagline: string;
  defaultModel: string;
  envKeys: string[];
  live: boolean;
  transport: string;
  source: string;
  model: string;
  maskedKey: string;
};

export default function SettingsModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; model: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/keys")
      .then((res) => res.json())
      .then((data: { providers: KeyStatus[] }) => {
        setStatuses(data.providers ?? []);
        setDrafts(
          (data.providers ?? []).reduce<Record<string, { apiKey: string; model: string }>>((acc, provider) => {
            acc[provider.id] = { apiKey: "", model: provider.defaultModel };
            return acc;
          }, {}),
        );
      })
      .finally(() => setLoading(false));
  }, [open]);

  const save = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSaving(id);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey: draft.apiKey, model: draft.model }),
      });
      const data = (await response.json()) as { live?: boolean; model?: string; maskedKey?: string };
      setStatuses((prev) =>
        prev.map((status) =>
          status.id === id
            ? {
                ...status,
                live: Boolean(data.live),
                model: data.model ?? status.model,
                maskedKey: data.maskedKey ?? "",
                transport: data.live ? "live" : "demo",
              }
            : status,
        ),
      );
      setDrafts((prev) => ({ ...prev, [id]: { apiKey: "", model: draft.model } }));
      onChanged?.();
    } finally {
      setSaving(null);
    }
  };

  if (!open) return null;

  const liveCount = statuses.filter((s) => s.live).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">AI kapcsolatok</h2>
            <p className="mt-1 text-sm text-slate-400">
              Add meg az API kulcsokat, és a modell azonnal élő kapcsolatra vált. Kulcs nélkül a beépített
              <span className="mx-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">demo agy</span>
              válaszol, így a chat így is működik. ({liveCount}/{statuses.length} élő)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
          >
            Bezárás
          </button>
        </div>

        {loading ? <p className="text-sm text-slate-400">Betöltés…</p> : null}

        <div className="space-y-3">
          {statuses.map((status) => {
            const draft = drafts[status.id] ?? { apiKey: "", model: status.defaultModel };
            return (
              <div key={status.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{status.name}</p>
                    <p className="text-xs text-slate-400">{status.tagline}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold ${
                      status.live
                        ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30"
                        : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30"
                    }`}
                  >
                    {status.live ? `ÉLŐ · ${status.model}` : "DEMO mód"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [status.id]: { ...draft, apiKey: event.target.value },
                      }))
                    }
                    placeholder={status.maskedKey || "API kulcs (sk-…)"}
                    className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400/50 focus:outline-none"
                  />
                  <input
                    value={draft.model}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [status.id]: { ...draft, model: event.target.value },
                      }))
                    }
                    placeholder={status.defaultModel}
                    className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void save(status.id)}
                    disabled={saving === status.id || draft.apiKey.trim().length < 8}
                    className="rounded-xl bg-indigo-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
                  >
                    {saving === status.id ? "ment…" : "Mentés"}
                  </button>
                </div>
                <p className="mt-2 text-[0.68rem] text-slate-500">
                  Env alternatíva: {status.envKeys.join(" / ")} · vagy adj meg egy OPENROUTER_API_KEY-t, akkor mind az
                  öt modell egy kulccsal élő lesz.
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
