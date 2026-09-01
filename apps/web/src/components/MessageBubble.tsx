import type { ChatMessage } from "../types.js";
import { BrandMark } from "./BrandMark.js";
import { ToolBadges } from "./ToolBadges.js";
import { TypingDots } from "./TypingDots.js";

interface MessageBubbleProps {
  message: ChatMessage;
  streaming: boolean;
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const assistant = message.role === "assistant";
  const pending = assistant && streaming && message.text === "";

  return (
    <div className={`row row--${message.role}`}>
      {assistant ? (
        <span className="avatar" aria-hidden="true">
          <BrandMark size={18} title="" />
        </span>
      ) : null}

      <article className={`bubble ${message.failed ? "bubble--failed" : ""}`}>
        <ToolBadges tools={message.toolCalls} label="used" />
        <div className="bubble__body">{pending ? <TypingDots /> : message.text}</div>
        {message.stats ? (
          <p className="bubble__meta">
            {message.stats.totalTokens} tokens · {Math.round(message.stats.latencyMs)} ms ·{" "}
            {message.stats.stopReason}
          </p>
        ) : null}
      </article>
    </div>
  );
}
