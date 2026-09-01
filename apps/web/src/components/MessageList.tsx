import { useEffect, useRef } from "react";

import type { ChatMessage } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";

interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
}

export function MessageList({ messages, streaming }: MessageListProps) {
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="empty muted">
        <p>Ask about your plan, data usage, invoices or support tickets.</p>
      </div>
    );
  }

  return (
    <div className="messages" aria-live="polite" aria-busy={streaming}>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} streaming={streaming} />
      ))}
      <div ref={anchor} />
    </div>
  );
}
