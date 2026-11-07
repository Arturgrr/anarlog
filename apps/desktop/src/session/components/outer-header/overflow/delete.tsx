import { Trans } from "@lingui/react/macro";
import { useCallback } from "react";

import { Trash } from "@anlg/ui/components/icons";
import { DropdownMenuItem } from "@anlg/ui/components/ui/dropdown-menu";
import { cn } from "@anlg/utils";

import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useSessionSummary } from "~/session/queries";

export function DeleteNote({ sessionId }: { sessionId: string }) {
  const deleteSession = useDeleteSession();
  const title = useSessionSummary(sessionId)?.title;

  const handleDeleteNote = useCallback(() => {
    deleteSession(sessionId, { title });
  }, [sessionId, deleteSession, title]);

  return (
    <DropdownMenuItem
      onClick={handleDeleteNote}
      className={cn([
        "text-danger cursor-pointer",
        "hover:text-danger focus:text-danger",
      ])}
    >
      <Trash />
      <span>
        <Trans>Delete</Trans>
      </span>
    </DropdownMenuItem>
  );
}
