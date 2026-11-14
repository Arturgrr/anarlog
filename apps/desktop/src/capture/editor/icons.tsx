import { type ReactNode } from "react";

function Glyph({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function LineIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M5 19 19 5" />
    </Glyph>
  );
}

export function EllipseIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <ellipse cx="12" cy="12" rx="9" ry="6.5" />
    </Glyph>
  );
}

export function PixelateIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 12h16M12 4v16" />
      <path
        d="M4 4h8v8H4zM12 12h8v8h-8z"
        fill="currentColor"
        stroke="none"
        opacity={0.35}
      />
    </Glyph>
  );
}

export function CounterIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.5 9.5 12.5 8v8.5" />
    </Glyph>
  );
}

export function CropIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M6 2.5V18h15.5" />
      <path d="M2.5 6H18v15.5" />
    </Glyph>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M5 19 19 5M10 5h9v9" />
    </Glyph>
  );
}

export function UndoIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Glyph>
  );
}

export function RedoIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Glyph>
  );
}
