import { useState, type FormEvent } from "react";

interface ComposerProps {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ streaming, onSend, onStop }: ComposerProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (streaming || !draft.trim()) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="message">
        Message
      </label>
      <input
        id="message"
        name="message"
        placeholder="Ask about your invoice, usage or plan"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={streaming}
        autoComplete="off"
      />
      {streaming ? (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      )}
    </form>
  );
}
