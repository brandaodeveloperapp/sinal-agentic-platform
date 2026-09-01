const SUGGESTIONS = [
  "I want to see my invoice",
  "How much data have I used",
  "Which plans are available",
  "I want to open a ticket",
];

interface EmptyStateProps {
  onPick: (text: string) => void;
  disabled: boolean;
}

export function EmptyState({ onPick, disabled }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty-title">How can I help?</p>
      <p className="empty-sub">
        Ask about your plan, data usage, invoices or support tickets.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion"
            disabled={disabled}
            onClick={() => onPick(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
