import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Dialog } from "@anlg/ui/components/ui/dialog";

import { NoteDetailsForm } from "./note-details-form";
import {
  type EditNoteRequest,
  saveNoteDetails,
  useEditNoteDialog,
} from "./useEditNote";

import {
  getSessionNoteType,
  type NoteTypeSelection,
} from "~/note-types/queries";

const NO_TYPE: NoteTypeSelection = { typeId: null, subtypeId: null };

export function EditNoteDialog() {
  const request = useEditNoteDialog((state) => state.request);
  const close = useEditNoteDialog((state) => state.close);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {request ? (
        <EditNoteContent
          key={request.sessionId}
          request={request}
          onClose={close}
        />
      ) : null}
    </Dialog>
  );
}

function EditNoteContent({
  request,
  onClose,
}: {
  request: EditNoteRequest;
  onClose: () => void;
}) {
  const noteType = useQuery({
    queryKey: ["edit-note-type", request.sessionId],
    // Without the current type the name can still be edited; the type is
    // then written only if the user picks one.
    queryFn: () =>
      getSessionNoteType(request.sessionId).catch((error: unknown) => {
        console.error("[session] failed to load note type", error);
        return NO_TYPE;
      }),
    gcTime: 0,
    staleTime: 0,
  });

  if (!noteType.data) return null;

  return (
    <EditNoteForm
      request={request}
      initialNoteType={noteType.data}
      onClose={onClose}
    />
  );
}

function EditNoteForm({
  request,
  initialNoteType,
  onClose,
}: {
  request: EditNoteRequest;
  initialNoteType: NoteTypeSelection;
  onClose: () => void;
}) {
  const save = useMutation({
    mutationFn: (value: { title: string; noteType: NoteTypeSelection }) =>
      saveNoteDetails(request, initialNoteType, value),
    onSuccess: onClose,
    onError: (error) => {
      console.error("[session] failed to save note name and type", error);
    },
  });

  return (
    <NoteDetailsForm
      title={<Trans>Name and type</Trans>}
      submitLabel={<Trans>Save</Trans>}
      error={
        save.isError ? (
          <Trans>Could not save the changes. Try again.</Trans>
        ) : null
      }
      defaultValues={{ title: request.title, noteType: initialNoteType }}
      pending={save.isPending}
      onSubmit={save.mutateAsync}
      onCancel={onClose}
    />
  );
}
