interface ToolNoteProps {
  tools: string[];
}

export function ToolNote({ tools }: ToolNoteProps) {
  if (tools.length === 0) return null;
  return (
    <p className="tool-note">
      used{" "}
      {tools.map((tool, index) => (
        <code key={`${tool}-${index}`}>{tool}</code>
      ))}
    </p>
  );
}
