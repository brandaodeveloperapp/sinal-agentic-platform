import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

const MAX_LENGTH = 2000;

interface ComposerProps {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ streaming, onSend, onStop }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [draft]);

  function submit() {
    if (streaming || !draft.trim()) return;
    onSend(draft);
    setDraft("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="composer-area" onSubmit={handleSubmit}>
      <div className="composer">
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          ref={textarea}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder="Type a message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
      </div>
      {streaming ? (
        <button className="send-btn" type="button" onClick={onStop} aria-label="Stop">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <rect x="4" y="4" width="10" height="10" rx="2" />
          </svg>
        </button>
      ) : (
        <button className="send-btn" type="submit" disabled={!draft.trim()} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 20.5v-6l8-2.5-8-2.5v-6l19 8.5z" />
          </svg>
        </button>
      )}
    </form>
  );
}
