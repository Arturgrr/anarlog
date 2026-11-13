import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";

import { toast } from "@anlg/ui/components/ui/toast";

import { NoteTypePicker } from "~/note-types/picker";
import {
  type NoteTypeSelection,
  setSessionNoteType,
  useSessionNoteType,
} from "~/note-types/queries";

export function NoteTypeEditor({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const stored = useSessionNoteType(sessionId);
  const update = useMutation({
    mutationFn: (next: NoteTypeSelection) =>
      setSessionNoteType(sessionId, next),
    onError: (error) => {
      console.error("[metadata] failed to update note type", error);
      toast.error(t`Could not update the note type.`);
    },
  });

  return (
    <NoteTypePicker
      value={(update.isPending ? update.variables : undefined) ?? stored}
      onChange={(next) => update.mutate(next)}
    />
  );
}
