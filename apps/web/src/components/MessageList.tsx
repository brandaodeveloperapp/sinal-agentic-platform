import { useEffect, useRef } from "react";

import type { ChatMessage } from "../types.js";
import { EmptyState } from "./EmptyState.js";
import { MessageBubble } from "./MessageBubble.js";

interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  onPickSuggestion: (text: string) => void;
}

export function MessageList({ messages, streaming, onPickSuggestion }: MessageListProps) {
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  return (
    <div className="thread" aria-live="polite" aria-busy={streaming}>
      {messages.length === 0 ? (
        <EmptyState onPick={onPickSuggestion} disabled={streaming} />
      ) : (
        messages.map((message) => (
          <MessageBubble key={message.id} message={message} streaming={streaming} />
        ))
      )}
      <div ref={anchor} />
    </div>
  );
}
