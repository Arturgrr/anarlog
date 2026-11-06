import { useCallback, useState } from "react";

import { X } from "@anlg/ui/components/icons";
import { Badge } from "@anlg/ui/components/ui/badge";
import { Button } from "@anlg/ui/components/ui/button";

import {
  removeSessionParticipant,
  useSessionParticipant,
} from "~/session/queries";
import { useTabs } from "~/store/zustand/tabs/index";
import { removeHumanSpeakerAssignments } from "~/stt/queries";

export function ParticipantChip({ mappingId }: { mappingId: string }) {
  const details = useParticipantDetails(mappingId);

  const assignedHumanId = details?.humanId;
  const sessionId = details?.sessionId;
  const source = details?.source;

  const { remove: handleRemove, isRemoving } = useRemoveParticipant({
    mappingId,
    assignedHumanId,
    sessionId,
  });

  const handleClick = useCallback(() => {
    if (assignedHumanId) {
      useTabs.getState().openNew({
        type: "contacts",
        state: { selected: { type: "person", id: assignedHumanId } },
      });
    }
  }, [assignedHumanId]);

  if (!details || source === "excluded" || isRemoving) {
    return null;
  }

  const { humanName, humanEmail } = details;
  const displayName = humanName.trim() || humanEmail?.trim();

  if (!displayName) {
    return null;
  }

  return (
    <Badge
      variant="secondary"
      className="bg-foreground/10 hover:bg-foreground/15 relative flex cursor-pointer items-center gap-1 overflow-hidden px-2 py-0.5 text-xs"
      onClick={handleClick}
    >
      <span className="relative">{displayName}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative ml-0.5 h-3 w-3 p-0 hover:bg-transparent"
        onClick={(e) => {
          e.stopPropagation();
          handleRemove();
        }}
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </Badge>
  );
}

function useParticipantDetails(mappingId: string) {
  const participant = useSessionParticipant(mappingId);

  if (!participant) {
    return null;
  }

  return {
    mappingId,
    humanId: participant.humanId,
    humanName: participant.name,
    humanEmail: participant.email || undefined,
    humanJobTitle: participant.jobTitle || undefined,
    humanLinkedinUsername: participant.linkedinUsername || undefined,
    orgId: participant.organizationId || undefined,
    orgName: participant.organizationName || undefined,
    sessionId: participant.sessionId,
    source: participant.source,
  };
}

function useRemoveParticipant({
  mappingId,
  assignedHumanId,
  sessionId,
}: {
  mappingId: string;
  assignedHumanId: string | undefined;
  sessionId: string | undefined;
}) {
  const [isRemoving, setIsRemoving] = useState(false);

  const remove = useCallback(() => {
    setIsRemoving(true);
    void (async () => {
      if (assignedHumanId && sessionId) {
        await removeHumanSpeakerAssignments(sessionId, assignedHumanId);
      }
      await removeSessionParticipant(mappingId);
    })().catch((error) => {
      setIsRemoving(false);
      console.error("[participants] failed to remove participant", error);
    });
  }, [mappingId, assignedHumanId, sessionId]);

  return { remove, isRemoving };
}
