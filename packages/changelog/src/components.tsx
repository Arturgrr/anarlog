import { isValidElement } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@anlg/utils";

function flattenTextContent(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }

  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "bigint"
  ) {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(flattenTextContent).join("");
  }

  if (isValidElement<{ children?: React.ReactNode }>(node)) {
    return flattenTextContent(node.props.children);
  }

  return "";
}

const changelogLinkClassName =
  "text-foreground decoration-border-strong hover:decoration-foreground underline underline-offset-2";

const changelogHeadingClassName =
  "text-strong mt-4 mb-1 min-h-6 font-semibold first:mt-0";
const changelogBodyClassName = "text-foreground";

const baseChangelogComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className={cn([changelogHeadingClassName, "text-base leading-6"])}>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className={cn([changelogHeadingClassName, "text-sm leading-5"])}>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className={cn([changelogHeadingClassName, "text-sm leading-5"])}>
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className={cn([changelogHeadingClassName, "text-sm leading-5"])}>
      {children}
    </h4>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <h5 className={cn([changelogHeadingClassName, "text-sm leading-5"])}>
      {children}
    </h5>
  ),
  h6: ({ children }: { children?: React.ReactNode }) => (
    <h6 className={cn([changelogHeadingClassName, "text-xs leading-4"])}>
      {children}
    </h6>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p
      className={cn([
        "mb-1 leading-5 [text-wrap:wrap]",
        changelogBodyClassName,
      ])}
    >
      {children}
    </p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="text-strong font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="border-border bg-layer-2 text-strong rounded-sm border-[0.5px] px-[0.3em] py-[0.15em] align-middle font-mono text-[0.85rem] leading-none">
      {children}
    </code>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className={cn(["mb-1 list-disc pl-6", changelogBodyClassName])}>
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className={cn(["mb-1 list-decimal pl-6", changelogBodyClassName])}>
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="mb-1">{children}</li>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-border-strong mb-1 border-l-[3px] pl-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      className={changelogLinkClassName}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img src={src} alt={alt} className="border-border my-6 rounded-lg border" />
  ),
};

export const changelogComponents = {
  ...baseChangelogComponents,
  banner: ({
    title,
    variant,
    children,
  }: {
    title?: string;
    variant?: string;
    children?: React.ReactNode;
  }) => (
    <div
      data-changelog-banner
      data-variant={variant ?? "default"}
      className={cn([
        "text-foreground mb-2 rounded-lg border px-5 pt-4 pb-4",
        variant === "warning"
          ? "border-border-strong bg-layer-2"
          : "border-border bg-muted",
      ])}
    >
      {title && (
        <div
          data-changelog-banner-title
          className="text-foreground mb-1 text-sm font-semibold"
        >
          {title}
        </div>
      )}
      <div
        data-changelog-banner-content
        className={cn([
          "text-sm [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0",
          changelogBodyClassName,
        ])}
      >
        <Streamdown
          components={baseChangelogComponents}
          isAnimating={false}
          linkSafety={{ enabled: false }}
        >
          {flattenTextContent(children)}
        </Streamdown>
      </div>
    </div>
  ),
};
