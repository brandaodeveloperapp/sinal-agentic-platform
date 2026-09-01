interface ToolRailProps {
  tools: string[];
}

export function ToolRail({ tools }: ToolRailProps) {
  if (tools.length === 0) return null;

  return (
    <details className="toolrail" open>
      <summary>tools available to you ({tools.length})</summary>
      <div className="chips">
        {tools.map((tool) => (
          <span className="chip" key={tool}>
            {tool}
          </span>
        ))}
      </div>
    </details>
  );
}
