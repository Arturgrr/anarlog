import type { ReactNode } from "react";

export function SettingsPageTitle({ title }: { title: ReactNode }) {
  return (
    <h2 className="font-sans text-3xl leading-tight font-medium tracking-normal">
      {title}
    </h2>
  );
}
