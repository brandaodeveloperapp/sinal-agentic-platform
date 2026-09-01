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
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
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
    <div className="composer-area">
      <form className="composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          ref={textarea}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder="Ask about your invoice, usage or plan"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        {streaming ? (
          <button className="btn btn-ghost" type="button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="btn" type="submit" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>

      <div className="composer-hint">
        <span>
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
        </span>
        {draft.length > MAX_LENGTH - 200 ? (
          <span>
            {draft.length}/{MAX_LENGTH}
          </span>
        ) : null}
      </div>
    </div>
  );
}
