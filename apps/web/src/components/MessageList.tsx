import { Fragment, useEffect, useRef } from "react";

import type { ChatMessage } from "../types.js";
import { EmptyState } from "./EmptyState.js";
import { MessageBubble } from "./MessageBubble.js";
import { ToolNote } from "./ToolNote.js";

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

  if (messages.length === 0) {
    return (
      <div className="thread" aria-live="polite" aria-busy={streaming}>
        <EmptyState onPick={onPickSuggestion} disabled={streaming} />
        <div ref={anchor} />
      </div>
    );
  }

  return (
    <div className="thread" aria-live="polite" aria-busy={streaming}>
      <p className="system-line">
        Answers come from Onda Telecom systems, not from memory. You only see what your account
        allows.
      </p>
      <span className="day-pill">Today</span>
      {messages.map((message) => (
        <Fragment key={message.id}>
          <ToolNote tools={message.toolCalls} specialist={message.specialist} />
          <MessageBubble message={message} streaming={streaming} />
        </Fragment>
      ))}
      <div ref={anchor} />
    </div>
  );
}
