import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";

import { Dialog } from "@anlg/ui/components/ui/dialog";
import { toast } from "@anlg/ui/components/ui/toast";

import { NoteDetailsForm } from "./note-details-form";
import {
  createRequestedNote,
  type NewNoteRequest,
  useNewNoteDialog,
} from "./useNewNote";

import type { NoteTypeSelection } from "~/note-types/queries";

export function NewNoteDialog() {
  const request = useNewNoteDialog((state) => state.request);
  const close = useNewNoteDialog((state) => state.close);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {request ? <NewNoteForm request={request} onClose={close} /> : null}
    </Dialog>
  );
}

function NewNoteForm({
  request,
  onClose,
}: {
  request: NewNoteRequest;
  onClose: () => void;
}) {
  const { t } = useLingui();

  const create = useMutation({
    mutationFn: (value: { title: string; noteType: NoteTypeSelection }) =>
      createRequestedNote(request, value),
    onSuccess: ({ typeError, folderError }) => {
      if (typeError) {
        console.error("[session] failed to set note type", typeError);
        toast.error(t`The note was created, but its type could not be set.`);
      }
      if (folderError) {
        console.error("[session] failed to catalog note folder", folderError);
        toast.error(
          t`The note was created, but its folder could not be updated.`,
        );
      }
      onClose();
    },
    onError: (error) => {
      console.error("[session] failed to create note", error);
    },
  });

  return (
    <NoteDetailsForm
      title={
        request.record ? <Trans>New recording</Trans> : <Trans>New note</Trans>
      }
      submitLabel={
        request.record ? (
          <Trans>Start recording</Trans>
        ) : (
          <Trans>Create note</Trans>
        )
      }
      error={
        create.isError ? (
          <Trans>Could not create the note. Try again.</Trans>
        ) : null
      }
      defaultValues={{ title: "", noteType: { typeId: null, subtypeId: null } }}
      pending={create.isPending}
      onSubmit={create.mutateAsync}
      onCancel={onClose}
    />
  );
}
