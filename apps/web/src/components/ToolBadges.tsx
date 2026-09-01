interface ToolBadgesProps {
  tools: string[];
  label: string;
}

export function ToolBadges({ tools, label }: ToolBadgesProps) {
  if (tools.length === 0) return null;

  return (
    <p className="tools">
      <span className="muted">{label}</span>
      {tools.map((tool, index) => (
        <span className="badge" key={`${tool}-${index}`}>
          {tool}
        </span>
      ))}
    </p>
  );
}
