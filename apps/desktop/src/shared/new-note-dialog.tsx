import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";

import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { Input } from "@anlg/ui/components/ui/input";
import { toast } from "@anlg/ui/components/ui/toast";

import {
  createRequestedNote,
  type NewNoteRequest,
  useNewNoteDialog,
} from "./useNewNote";

import { NoteTypePicker } from "~/note-types/picker";
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
  const nameRef = useRef<HTMLInputElement>(null);

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

  const form = useForm({
    defaultValues: {
      title: "",
      noteType: { typeId: null, subtypeId: null } as NoteTypeSelection,
    },
    onSubmit: ({ value }) =>
      create
        .mutateAsync({ title: value.title.trim(), noteType: value.noteType })
        .catch(() => undefined),
  });

  const pending = create.isPending;

  return (
    <DialogContent
      className="max-w-sm"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        nameRef.current?.focus();
      }}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <form
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pending) return;
          void form.handleSubmit();
        }}
      >
        <div className="flex flex-col gap-1 pr-6">
          <DialogTitle className="text-base leading-normal font-semibold">
            {request.record ? (
              <Trans>New recording</Trans>
            ) : (
              <Trans>New note</Trans>
            )}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            <Trans>You can leave the name empty and add it later.</Trans>
          </DialogDescription>
        </div>

        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-1">
          <form.Field name="title">
            {(field) => (
              <label className="flex min-w-0 items-center gap-2">
                <span className="text-muted-foreground w-16 shrink-0 text-xs">
                  <Trans>Name</Trans>
                </span>
                <Input
                  ref={nameRef}
                  data-new-note-name
                  placeholder={t`Untitled`}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="min-w-0 flex-1"
                />
              </label>
            )}
          </form.Field>
          <form.Field name="noteType">
            {(field) => (
              <NoteTypePicker
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </fieldset>

        {create.isError ? (
          <p role="alert" className="text-danger text-xs">
            <Trans>Could not create the note. Try again.</Trans>
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={pending}>
            {request.record ? (
              <Trans>Start recording</Trans>
            ) : (
              <Trans>Create note</Trans>
            )}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
