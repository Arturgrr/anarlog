import type { ComponentType, ReactNode } from "react";

import { cn } from "@anlg/utils";

import { staticAssetUrl, fallbackToLocalAsset } from "~/shared/static-assets";

type LobeIconComponent = ComponentType<{
  color?: string;
  size?: number | string;
}> & {
  Color?: ComponentType<{ size?: number | string }>;
  colorPrimary?: string;
};

const THEME_TINTED_BRAND_COLORS = new Set([
  "#000",
  "#000000",
  "#fff",
  "#ffffff",
  "#141413",
  "#16191e",
  "#f1f0e8",
]);

export function ProviderLobeIcon({ icon: Icon }: { icon: LobeIconComponent }) {
  if (Icon.Color) {
    return <Icon.Color />;
  }

  const brandColor = Icon.colorPrimary?.toLowerCase();
  if (brandColor && !THEME_TINTED_BRAND_COLORS.has(brandColor)) {
    return <Icon color={Icon.colorPrimary} />;
  }

  return <Icon />;
}

export function ProviderBrandImage({
  src,
  alt,
  className,
  preserveColor = false,
}: {
  src: string;
  alt: string;
  className?: string;
  preserveColor?: boolean;
}) {
  return (
    <img
      src={staticAssetUrl(src)}
      onError={fallbackToLocalAsset(src)}
      alt={alt}
      data-slot={preserveColor ? "provider-color-icon" : "provider-brand-icon"}
      className={cn([
        "object-contain object-center",
        !preserveColor && "[filter:var(--provider-brand-filter)]",
        className,
      ])}
    />
  );
}

function AiIconSlot({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      data-slot="ai-icon"
      className={cn([
        "text-foreground flex size-5 shrink-0 items-center justify-center overflow-hidden",
        "[&_[data-slot=provider-brand-icon]]:[filter:var(--provider-brand-filter)]",
        className,
      ])}
    >
      <span
        data-slot="ai-icon-art"
        className={cn([
          "flex size-full items-center justify-center overflow-hidden",
          "[&>img]:block [&>img]:size-full [&>svg]:block [&>svg]:size-full [&>svg]:text-inherit",
        ])}
      >
        {children}
      </span>
    </span>
  );
}

export function ProviderIconSlot({ children }: { children: ReactNode }) {
  return (
    <AiIconSlot className="[--soniox-icon-scale:1.6667] [&_[data-slot=ai-icon-art]]:size-3 [&_[data-slot=ai-icon-art]]:overflow-visible">
      {children}
    </AiIconSlot>
  );
}
