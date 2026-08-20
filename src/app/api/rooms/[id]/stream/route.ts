import { getMessagesSince, getOnlineHumans } from "@/lib/chat/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const POLL_INTERVAL_MS = 700;
const MAX_LIFETIME_MS = 50_000;

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5_000);

  const encoder = new TextEncoder();
  let cursor = Number.isNaN(since.getTime()) ? new Date(Date.now() - 5_000) : since;
  const startedAt = Date.now();
  let lastHumansHash = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      send("ready", { since: cursor.toISOString() });

      const tick = async () => {
        if (closed) return;
        try {
          const [rows, humans] = await Promise.all([getMessagesSince(id, cursor), getOnlineHumans(id)]);
          const latest = rows
            .map((row) => new Date(row.updatedAt).getTime())
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b);
          if (latest.length > 0) {
            cursor = new Date(latest[latest.length - 1] + 1);
          }
          if (rows.length > 0) send("messages", rows);

          const humansHash = humans.map((h) => h.name).join("|");
          if (humansHash !== lastHumansHash) {
            lastHumansHash = humansHash;
            send("humans", humans);
          }

          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "stream hiba" });
        }

        if (Date.now() - startedAt > MAX_LIFETIME_MS) {
          send("bye", { reconnect: true });
          closed = true;
          controller.close();
          return;
        }

        setTimeout(tick, POLL_INTERVAL_MS);
      };

      setTimeout(tick, 120);
      request.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
