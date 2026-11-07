import { cn } from "@anlg/utils";

const levelColors: Record<string, string> = {
  ERROR: "text-danger",
  WARN: "text-foreground font-medium",
  INFO: "text-muted-foreground",
  DEBUG: "text-faint",
  TRACE: "text-faint",
};

export function LogEntry({ text }: { text: string }) {
  const match = text.match(
    /^(\d{4}-\d{2}-\d{2}T\S+)(\s+)(ERROR|WARN|INFO|DEBUG|TRACE)(\s+)(\S+:)(\s?)([\s\S]*)$/,
  );

  if (!match) {
    return <>{text}</>;
  }

  const [
    ,
    timestamp,
    beforeLevel,
    level,
    beforeSource,
    source,
    space,
    message,
  ] = match;

  return (
    <>
      <span className="text-muted-foreground">{timestamp}</span>
      {beforeLevel}
      <span className={cn(["font-semibold", levelColors[level]])}>{level}</span>
      {beforeSource}
      <span className="text-muted-foreground">{source}</span>
      {space}
      {message}
    </>
  );
}
