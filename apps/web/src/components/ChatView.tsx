import { useChat } from "../hooks/useChat.js";
import type { AuthenticatedUser } from "../types.js";
import { Composer } from "./Composer.js";
import { MessageList } from "./MessageList.js";
import { ToolBadges } from "./ToolBadges.js";

interface ChatViewProps {
  user: AuthenticatedUser;
  token: string;
  onSignOut: () => void;
}

export function ChatView({ user, token, onSignOut }: ChatViewProps) {
  const chat = useChat(token);

  return (
    <main className="chat">
      <header className="topbar">
        <div>
          <strong>{user.displayName}</strong>
          <span className="muted">
            {user.actor === "attendant" ? "support desk" : (user.customerId ?? "no customer")}
          </span>
        </div>
        <button type="button" className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <ToolBadges tools={chat.availableTools} label="tools available to you" />

      <MessageList messages={chat.messages} streaming={chat.streaming} />

      {chat.error ? (
        <p className="error" role="alert">
          {chat.error}
        </p>
      ) : null}

      <Composer streaming={chat.streaming} onSend={chat.send} onStop={chat.stop} />
    </main>
  );
}
