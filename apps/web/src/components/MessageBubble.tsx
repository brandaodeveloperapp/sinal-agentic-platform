import type { ChatMessage } from "../types.js";
import { TypingDots } from "./TypingDots.js";

interface MessageBubbleProps {
  message: ChatMessage;
  streaming: boolean;
}

function Ticks() {
  return (
    <span className="bubble__ticks" aria-hidden="true">
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path
          d="M11.1 0.5 5.2 8.4 2.9 6 1.8 7 5.3 10.5 12.3 1.5zM15 0.5 9.1 8.4 8.2 7.2 7.1 8.2 9.2 10.5 16.2 1.5z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const assistant = message.role === "assistant";
  const pending = assistant && streaming && message.text === "";

  return (
    <div className={`row row--${message.role}`}>
      <article className={`bubble ${message.failed ? "bubble--failed" : ""}`}>
        {pending ? (
          <TypingDots />
        ) : (
          <span className="bubble__text">{message.text}</span>
        )}

        {!pending ? (
          <span className="bubble__meta">
            {message.time}
            {!assistant ? <Ticks /> : null}
          </span>
        ) : null}

        {message.stats ? (
          <span className="bubble__cost">
            {message.stats.totalTokens} tokens · {Math.round(message.stats.latencyMs)} ms ·{" "}
            {message.stats.stopReason}
          </span>
        ) : null}
      </article>
    </div>
  );
}
