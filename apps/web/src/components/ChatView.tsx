import { useChat } from "../hooks/useChat.js";
import type { AuthenticatedUser } from "../types.js";
import { BrandMark } from "./BrandMark.js";
import { Composer } from "./Composer.js";
import { MessageList } from "./MessageList.js";

interface ChatViewProps {
  user: AuthenticatedUser;
  token: string;
  onSignOut: () => void;
}

export function ChatView({ user, token, onSignOut }: ChatViewProps) {
  const chat = useChat(token);

  const status = chat.streaming
    ? "typing…"
    : chat.availableTools.length > 0
      ? `${chat.availableTools.length} tools available to you`
      : user.actor === "attendant"
        ? "support desk"
        : "online";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__identity">
          <span className="topbar__avatar">
            <BrandMark size={26} />
          </span>
          <div className="topbar__who">
            <strong>Onda Telecom</strong>
            <span>{status}</span>
          </div>
        </div>
        <div className="topbar__actions">
          <span className="sr-only">signed in as {user.displayName}</span>
          <button className="icon-btn" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <MessageList
        messages={chat.messages}
        streaming={chat.streaming}
        onPickSuggestion={chat.send}
      />

      {chat.error ? (
        <p className="alert" role="alert">
          {chat.error}
        </p>
      ) : null}

      <Composer streaming={chat.streaming} onSend={chat.send} onStop={chat.stop} />
    </div>
  );
}
