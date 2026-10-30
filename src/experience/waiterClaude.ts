import { useEffect, useRef, useState } from "react";

export interface WaiterContext {
  view: "explore" | "table" | "plan";
  mode: "map" | "book" | "real";
  venueId: string;
  participantCount: number;
  budget: number;
  restrictions: string[];
  planVenueId?: string;
  planSaved: boolean;
}

type Mode = "checking" | "mock" | "live" | "disabled" | "unavailable";
interface Reply {
  source: "mock" | "anthropic";
  text: string;
}

/** The browser sends a bounded question, never credentials, coordinates or names. */
export function useWaiterClaude(
  open: boolean,
  context: WaiterContext,
  scope: string,
) {
  const [mode, setMode] = useState<Mode>("checking");
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const currentScope = `${open}:${scope}:${JSON.stringify(context)}`;
  const latestScope = useRef(currentScope);
  latestScope.current = currentScope;

  function clear() {
    const previous = active.current;
    active.current = null;
    previous?.abort();
    setBusy(false);
    setReply(null);
    setError("");
  }

  useEffect(() => {
    clear();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [currentScope]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    setMode("checking");
    void (async () => {
      try {
        const response = await fetch("/api/waiter/status", {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Unavailable");
        const body: unknown = await response.json();
        if (
          !body ||
          typeof body !== "object" ||
          !("mode" in body) ||
          !["mock", "live", "disabled"].includes(String(body.mode))
        )
          throw new Error("Unavailable");
        if (current && !controller.signal.aborted) setMode(body.mode as Mode);
      } catch {
        if (current) setMode("unavailable");
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      current = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open]);

  async function ask(message: string) {
    if (active.current || !open || !["mock", "live"].includes(mode)) return;
    const controller = new AbortController();
    active.current = controller;
    const submittedScope = latestScope.current;
    const isCurrent = () =>
      active.current === controller &&
      latestScope.current === submittedScope &&
      !controller.signal.aborted;
    setReply(null);
    setError("");
    setBusy(true);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    try {
      const response = await fetch("/api/waiter/reply", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Common-Table-Request": "waiter",
        },
        body: JSON.stringify({ message, context }),
      });
      if (!response.ok) {
        // Provider details and arbitrary error bodies are never shown to users.
        throw new Error(response.status === 429 ? "busy" : "unavailable");
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("source" in body) ||
        !("text" in body) ||
        !["mock", "anthropic"].includes(String(body.source)) ||
        (mode === "mock" && body.source !== "mock") ||
        typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.length > 8_000
      )
        throw new Error("unavailable");
      const replyText = body.source === "mock"
        ? body.text.replace(/^Offline demo · Claude not called\.\s*/, "")
        : body.text;
      if (!replyText.trim()) throw new Error("unavailable");
      if (isCurrent())
        setReply({
          source: body.source as Reply["source"],
          text: replyText,
        });
    } catch (cause) {
      if (
        active.current === controller &&
        latestScope.current === submittedScope &&
        (!controller.signal.aborted || timedOut)
      )
        setError(
          timedOut
            ? "The answer took too long. You can try again when you’re ready."
            : cause instanceof Error && cause.message === "busy"
              ? "The Waiter is finishing a request. Please wait a moment."
              : "The answer couldn’t be brought to your table. Local tips are still available.",
        );
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return { mode, reply, error, busy, ask, clear };
}
