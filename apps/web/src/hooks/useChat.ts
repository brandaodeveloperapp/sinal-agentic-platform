import { useCallback, useRef, useState } from "react";

import { ApiError, streamTurn } from "../api/client.js";
import type { ChatMessage } from "../types.js";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

export interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  availableTools: string[];
  error: string | null;
}

export function useChat(token: string | null) {
  const sessionId = useRef(`web-${newId()}`);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<ChatState>({
    messages: [],
    streaming: false,
    availableTools: [],
    error: null,
  });

  const patchAssistant = useCallback((id: string, patch: (message: ChatMessage) => ChatMessage) => {
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) => (message.id === id ? patch(message) : message)),
    }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !token) return;

      const assistantId = newId();
      abortRef.current = new AbortController();

      setState((current) => ({
        ...current,
        streaming: true,
        error: null,
        messages: [
          ...current.messages,
          { id: newId(), role: "user", text: trimmed, toolCalls: [] },
          { id: assistantId, role: "assistant", text: "", toolCalls: [] },
        ],
      }));

      try {
        for await (const event of streamTurn({
          token,
          message: trimmed,
          sessionId: sessionId.current,
          signal: abortRef.current.signal,
        })) {
          switch (event.type) {
            case "ready":
              setState((current) => ({ ...current, availableTools: event.tools }));
              break;
            case "tool_call":
              patchAssistant(assistantId, (message) => ({
                ...message,
                toolCalls: [...message.toolCalls, event.name],
              }));
              break;
            case "token":
              patchAssistant(assistantId, (message) => ({
                ...message,
                text: message.text + event.text,
              }));
              break;
            case "done":
              patchAssistant(assistantId, (message) => ({
                ...message,
                stats: {
                  latencyMs: event.latencyMs,
                  totalTokens: event.totalTokens,
                  stopReason: event.stopReason,
                },
              }));
              break;
            case "error":
              patchAssistant(assistantId, (message) => ({
                ...message,
                text: message.text || event.message,
                failed: true,
              }));
              break;
          }
        }
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : "The answer was interrupted. Try again.";
        patchAssistant(assistantId, (current) => ({
          ...current,
          text: current.text || message,
          failed: true,
        }));
        setState((current) => ({ ...current, error: message }));
      } finally {
        abortRef.current = null;
        setState((current) => ({ ...current, streaming: false }));
      }
    },
    [patchAssistant, token],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { ...state, send, stop };
}
