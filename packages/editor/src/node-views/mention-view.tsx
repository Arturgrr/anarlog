import { type NodeViewComponentProps } from "@handlewithcare/react-prosemirror";
import { Facehash, stringHash } from "facehash";
import type { NodeSpec } from "prosemirror-model";
import { forwardRef, useCallback } from "react";

import { Buildings, Folder, Note, User } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

export const mentionNodeSpec: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    id: { default: null },
    type: { default: null },
    label: { default: null },
  },
  parseDOM: [
    {
      tag: 'span.mention[data-mention="true"]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          id: el.getAttribute("data-id"),
          type: el.getAttribute("data-type"),
          label: el.getAttribute("data-label"),
        };
      },
    },
  ],
  toDOM(node) {
    return [
      "span",
      {
        class: "mention",
        "data-mention": "true",
        "data-id": node.attrs.id,
        "data-type": node.attrs.type,
        "data-label": node.attrs.label,
      },
      node.attrs.label || "",
    ];
  },
};

const GLOBAL_NAVIGATE_FUNCTION = "__ANARLOG_NAVIGATE__";

const FACEHASH_BG_CLASSES = ["bg-layer-2", "bg-layer-3", "bg-layer-4"];

function getMentionFacehashBgClass(name: string) {
  const hash = stringHash(name);
  return FACEHASH_BG_CLASSES[hash % FACEHASH_BG_CLASSES.length];
}

function MentionAvatar({
  id,
  type,
  label,
}: {
  id: string;
  type: string;
  label: string;
}) {
  if (type === "human") {
    const facehashName = label || id || "?";
    const bgClass = getMentionFacehashBgClass(facehashName);
    return (
      <span className={cn(["mention-avatar", bgClass])}>
        <Facehash
          name={facehashName}
          size={16}
          showInitial={true}
          interactive={false}
          className="text-foreground"
          colorClasses={[bgClass]}
        />
      </span>
    );
  }

  const Icon =
    type === "session"
      ? Note
      : type === "organization"
        ? Buildings
        : type === "folder"
          ? Folder
          : User;

  return (
    <span className="mention-avatar mention-avatar-icon">
      <Icon className="mention-inline-icon" />
    </span>
  );
}

export const MentionNodeView = forwardRef<HTMLElement, NodeViewComponentProps>(
  function MentionNodeView({ nodeProps, ...htmlAttrs }, ref) {
    const { node } = nodeProps;
    const { id, type, label } = node.attrs;
    const mentionId = String(id ?? "");
    const mentionType = String(type ?? "");
    const mentionLabel = String(label ?? "");
    const MAX_MENTION_LENGTH = 20;
    const displayLabel =
      mentionLabel.length > MAX_MENTION_LENGTH
        ? mentionLabel.slice(0, MAX_MENTION_LENGTH) + "\u2026"
        : mentionLabel;
    const path = `/app/${mentionType}/${mentionId}`;

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        const navigate = (window as any)[GLOBAL_NAVIGATE_FUNCTION];
        if (navigate) navigate(path);
      },
      [path],
    );

    return (
      <span ref={ref} {...htmlAttrs}>
        <a
          className="mention"
          data-mention="true"
          data-id={mentionId}
          data-type={mentionType}
          data-label={mentionLabel}
          href="javascript:void(0)"
          onClick={handleClick}
        >
          <MentionAvatar
            id={mentionId}
            type={mentionType}
            label={mentionLabel}
          />
          <span className="mention-text">{displayLabel}</span>
        </a>
      </span>
    );
  },
);
