import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { type ReactNode, useRef } from "react";

import { Button } from "@anlg/ui/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { Input } from "@anlg/ui/components/ui/input";

import { NoteTypePicker } from "~/note-types/picker";
import type { NoteTypeSelection } from "~/note-types/queries";

export function NoteDetailsForm({
  title,
  submitLabel,
  error,
  defaultValues,
  pending,
  onSubmit,
  onCancel,
}: {
  title: ReactNode;
  submitLabel: ReactNode;
  error: ReactNode;
  defaultValues: { title: string; noteType: NoteTypeSelection };
  pending: boolean;
  onSubmit: (value: {
    title: string;
    noteType: NoteTypeSelection;
  }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const nameRef = useRef<HTMLInputElement>(null);

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) =>
      onSubmit({ title: value.title.trim(), noteType: value.noteType }).catch(
        () => undefined,
      ),
  });

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
            {title}
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

        {error ? (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onCancel}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
