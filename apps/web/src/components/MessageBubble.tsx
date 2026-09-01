import type { ChatMessage } from "../types.js";
import { ToolBadges } from "./ToolBadges.js";

interface MessageBubbleProps {
  message: ChatMessage;
  streaming: boolean;
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const pending = message.role === "assistant" && streaming && message.text === "";

  return (
    <article className={`bubble ${message.role} ${message.failed ? "failed" : ""}`}>
      <ToolBadges tools={message.toolCalls} label="used" />
      <p className="text">
        {message.text}
        {pending ? <span className="cursor" aria-label="assistant is typing" /> : null}
      </p>
      {message.stats ? (
        <p className="stats muted">
          {message.stats.totalTokens} tokens · {Math.round(message.stats.latencyMs)} ms ·{" "}
          {message.stats.stopReason}
        </p>
      ) : null}
    </article>
  );
}
