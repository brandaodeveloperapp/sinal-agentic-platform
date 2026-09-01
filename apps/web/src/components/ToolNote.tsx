interface ToolNoteProps {
  tools: string[];
  specialist?: string;
}

export function ToolNote({ tools, specialist }: ToolNoteProps) {
  if (tools.length === 0 && !specialist) return null;
  return (
    <p className="tool-note">
      {specialist ? <span className="tool-note__agent">{specialist} agent</span> : null}
      {tools.length > 0 ? "used " : null}
      {tools.map((tool, index) => (
        <code key={`${tool}-${index}`}>{tool}</code>
      ))}
    </p>
  );
}
