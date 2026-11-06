import { t } from "@lingui/core/macro";

import { MagicWand } from "@anlg/ui/components/icons";

import { defineTool } from "./define-tool";
import { ToolCardBody, ToolCardFooterError, ToolCardFooters } from "./shared";

import { parseMcpObjectOutput } from "~/chat/mcp/mcp-output-parser";

type UpdatePromptTemplateOutput = {
  status?: string;
  message?: string;
  lineCount?: number;
};

function parseUpdatePromptTemplateOutput(
  output: unknown,
): UpdatePromptTemplateOutput | null {
  return parseMcpObjectOutput<UpdatePromptTemplateOutput>(output);
}

export const ToolUpdatePromptTemplate = defineTool({
  icon: <MagicWand />,
  parseFn: parseUpdatePromptTemplateOutput,
  isDone: (parsed) => parsed?.status === "applied",
  label: ({ running, failed, parsed }) => {
    if (running) return t`Updating prompt draft`;
    if (failed) return t`Prompt update failed`;
    if (parsed?.status === "applied") return t`Prompt draft updated`;
    return t`Update prompt draft`;
  },
  renderBody: (input) =>
    typeof input?.content === "string" ? (
      <ToolCardBody>
        <pre className="border-border bg-muted text-muted-foreground max-h-48 overflow-auto rounded-md border p-3 font-mono text-[11px] whitespace-pre-wrap">
          {input.content}
        </pre>
      </ToolCardBody>
    ) : null,
  renderFooter: ({ failed, errorText, parsed }) => (
    <ToolCardFooters failed={failed} errorText={errorText} rawText={null}>
      {parsed?.status === "error" ? (
        <ToolCardFooterError text={parsed.message ?? t`Unknown error`} />
      ) : parsed?.message ? (
        <p className="text-muted-foreground text-xs">{parsed.message}</p>
      ) : null}
    </ToolCardFooters>
  ),
});
