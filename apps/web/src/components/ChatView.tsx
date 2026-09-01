import { useChat } from "../hooks/useChat.js";
import type { AuthenticatedUser } from "../types.js";
import { BrandMark } from "./BrandMark.js";
import { Composer } from "./Composer.js";
import { MessageList } from "./MessageList.js";
import { ToolRail } from "./ToolRail.js";

interface ChatViewProps {
  user: AuthenticatedUser;
  token: string;
  onSignOut: () => void;
}

export function ChatView({ user, token, onSignOut }: ChatViewProps) {
  const chat = useChat(token);
  const role = user.actor === "attendant" ? "support desk" : (user.customerId ?? "no customer");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__identity">
          <BrandMark size={30} />
          <div className="topbar__who">
            <strong>{user.displayName}</strong>
            <span>{role}</span>
          </div>
        </div>

        <div className="topbar__identity">
          <span className="pill">
            <span className="pill__dot" />
            {chat.streaming ? "answering" : "ready"}
          </span>
          <button className="btn btn-ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <ToolRail tools={chat.availableTools} />

      <MessageList
        messages={chat.messages}
        streaming={chat.streaming}
        onPickSuggestion={chat.send}
      />

      {chat.error ? (
        <p className="alert alert--floating" role="alert">
          {chat.error}
        </p>
      ) : null}

      <Composer streaming={chat.streaming} onSend={chat.send} onStop={chat.stop} />
    </div>
  );
}
