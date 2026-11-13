import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  Check,
  ListBullets,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Input } from "@anlg/ui/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@anlg/ui/components/ui/input-group";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import {
  createNoteType,
  deleteNoteType,
  type NoteType,
  renameNoteType,
  useNoteTypes,
} from "~/note-types/queries";
import { SettingsPageTitle } from "~/settings/page-title";
import { DestructiveConfirmationDialog } from "~/shared/ui/destructive-confirmation-dialog";

export function SettingsNoteTypes() {
  const noteTypes = useNoteTypes();
  const types = noteTypes.filter((type) => type.parentId === null);
  const [pendingDelete, setPendingDelete] = useState<NoteType | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => deleteNoteType(id),
    onSuccess: () => setPendingDelete(null),
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <SettingsPageTitle title={<Trans>Note types</Trans>} />
        <p className="text-muted-foreground text-sm">
          <Trans>
            Group notes by type and subtype, like a class and its subject or a
            client and a recurring meeting. Set them from a note's meeting info.
          </Trans>
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <AddNoteTypeForm parentId={null} />

        {types.length === 0 ? (
          <div className="bg-card shadow-raised flex min-h-40 flex-col items-center justify-center rounded-lg px-6 text-center">
            <ListBullets className="text-muted-foreground mb-3 size-5" />
            <p className="text-sm font-medium">
              <Trans>No note types yet</Trans>
            </p>
            <p className="text-muted-foreground mt-1 max-w-sm text-xs">
              <Trans>Add a type above, then add subtypes under it.</Trans>
            </p>
          </div>
        ) : (
          types.map((type) => (
            <div
              key={type.id}
              className="bg-card shadow-raised divide-border-muted divide-y overflow-hidden rounded-lg"
            >
              <NoteTypeRow
                noteType={type}
                siblings={types}
                onDelete={() => {
                  remove.reset();
                  setPendingDelete(type);
                }}
              />
              {noteTypes
                .filter((subtype) => subtype.parentId === type.id)
                .map((subtype, _index, subtypes) => (
                  <NoteTypeRow
                    key={subtype.id}
                    noteType={subtype}
                    siblings={subtypes}
                    onDelete={() => {
                      remove.reset();
                      setPendingDelete(subtype);
                    }}
                  />
                ))}
              <div className="py-2 pr-3 pl-8">
                <AddNoteTypeForm parentId={type.id} />
              </div>
            </div>
          ))
        )}
      </div>

      <DestructiveConfirmationDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete?.parentId ? (
            <Trans>Delete subtype "{pendingDelete.name}"?</Trans>
          ) : (
            <Trans>Delete type "{pendingDelete?.name}"?</Trans>
          )
        }
        description={
          remove.isError ? (
            <Trans>Could not delete it. Please try again.</Trans>
          ) : pendingDelete?.parentId ? (
            <Trans>Notes with this subtype will show no subtype.</Trans>
          ) : (
            <Trans>
              Its subtypes are deleted too. Notes of this type will show no
              type.
            </Trans>
          )
        }
        confirmLabel={<Trans>Delete</Trans>}
        isPending={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}

function AddNoteTypeForm({ parentId }: { parentId: string | null }) {
  const { t } = useLingui();
  const create = useMutation({
    mutationFn: (name: string) => createNoteType({ name, parentId }),
    onError: (error) => {
      console.error("[note-types] failed to create", error);
      toast.error(t`Could not add it. Please try again.`);
    },
  });
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value, formApi }) => {
      if (!value.name.trim()) return;
      await create.mutateAsync(value.name);
      formApi.reset();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <InputGroup>
        <form.Field name="name">
          {(field) => (
            <InputGroupInput
              className="pr-4 pl-4"
              placeholder={
                parentId
                  ? t`Add a subtype`
                  : t`Add a type, like Class or Client`
              }
              aria-label={parentId ? t`New subtype name` : t`New type name`}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <InputGroupAddon align="inline-end">
          <form.Subscribe
            selector={(state) => [
              state.values.name.trim().length > 0,
              state.isSubmitting,
            ]}
          >
            {([hasName, isSubmitting]) => (
              <InputGroupButton
                type="submit"
                variant="ghost"
                size="xs"
                className={cn([
                  parentId
                    ? "text-muted-foreground hover:text-foreground"
                    : "bg-primary text-primary-foreground shadow-button-contrast hover:bg-primary/90 hover:text-primary-foreground rounded-sm",
                ])}
                disabled={!hasName || isSubmitting}
                aria-label={parentId ? t`Add subtype` : t`Add type`}
              >
                <Plus className="size-3.5" />
                <Trans>Add</Trans>
              </InputGroupButton>
            )}
          </form.Subscribe>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function NoteTypeRow({
  noteType,
  siblings,
  onDelete,
}: {
  noteType: NoteType;
  siblings: NoteType[];
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const [editValue, setEditValue] = useState<string | null>(null);
  const isSubtype = noteType.parentId !== null;
  const nextName = editValue?.trim() ?? "";
  const nameTaken = siblings.some(
    (sibling) =>
      sibling.id !== noteType.id &&
      sibling.name.trim().toLocaleLowerCase() === nextName.toLocaleLowerCase(),
  );
  const canSave = nextName.length > 0 && !nameTaken;
  const rename = useMutation({
    mutationFn: (name: string) => renameNoteType(noteType.id, name),
    onSuccess: () => setEditValue(null),
    onError: (error) => {
      console.error("[note-types] failed to rename", error);
      toast.error(t`Could not rename "${noteType.name}".`);
    },
  });

  const save = () => {
    if (!canSave) return;
    if (nextName === noteType.name) {
      setEditValue(null);
      return;
    }
    rename.mutate(nextName);
  };

  const rowClassName = cn([
    "group flex min-h-12 items-center gap-2 pr-3",
    isSubtype ? "pl-8" : "pl-4",
  ]);

  if (editValue !== null) {
    return (
      <div className={cn([rowClassName, "py-2"])}>
        <Input
          autoFocus
          className="h-7 min-w-0 flex-1"
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setEditValue(null);
            }
          }}
          aria-label={t`Rename ${noteType.name}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-7 shrink-0"
          onClick={save}
          disabled={!canSave || rename.isPending}
          aria-label={t`Save`}
        >
          <Check className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-7 shrink-0"
          onClick={() => setEditValue(null)}
          aria-label={t`Cancel`}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn([rowClassName, "justify-between py-3"])}>
      <span
        className={cn([
          "min-w-0 truncate text-sm",
          isSubtype ? "text-muted-foreground" : "font-medium",
        ])}
      >
        {noteType.name}
      </span>
      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditValue(noteType.name)}
          aria-label={t`Rename ${noteType.name}`}
        >
          <PencilSimple className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          aria-label={t`Delete ${noteType.name}`}
        >
          <Trash className="size-4" />
        </Button>
      </div>
    </div>
  );
}
