import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { CaretDown, Check, Plus, X } from "@anlg/ui/components/icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@anlg/ui/components/ui/command";
import {
  AppFloatingPanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@anlg/ui/components/ui/popover";
import { toast } from "@anlg/ui/components/ui/toast";
import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

import {
  createNoteType,
  type NoteType,
  type NoteTypeSelection,
  useNoteTypes,
} from "./queries";

const filterByName = (value: string, search: string) =>
  value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? 1 : 0;

export function NoteTypePicker({
  value,
  onChange,
  allowCreate = true,
}: {
  value: NoteTypeSelection;
  onChange: (next: NoteTypeSelection) => void;
  allowCreate?: boolean;
}) {
  const { t } = useLingui();
  const noteTypes = useNoteTypes();
  const types = noteTypes.filter((type) => type.parentId === null);
  const type = types.find((candidate) => candidate.id === value.typeId) ?? null;
  const subtypes = type
    ? noteTypes.filter((candidate) => candidate.parentId === type.id)
    : [];
  const subtype =
    subtypes.find((candidate) => candidate.id === value.subtypeId) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <NoteTypeField
        label={t`Type`}
        placeholder={t`No type`}
        searchPlaceholder={
          allowCreate ? t`Search or create type` : t`Search types`
        }
        parentId={null}
        options={types}
        selected={type}
        allowCreate={allowCreate}
        onSelect={(typeId) =>
          onChange({
            typeId,
            subtypeId: typeId === type?.id ? (subtype?.id ?? null) : null,
          })
        }
      />
      {type ? (
        <NoteTypeField
          label={t`Subtype`}
          placeholder={t`No subtype`}
          searchPlaceholder={
            allowCreate ? t`Search or create subtype` : t`Search subtypes`
          }
          parentId={type.id}
          options={subtypes}
          selected={subtype}
          allowCreate={allowCreate}
          onSelect={(subtypeId) => onChange({ typeId: type.id, subtypeId })}
        />
      ) : null}
    </div>
  );
}

function NoteTypeField({
  label,
  placeholder,
  searchPlaceholder,
  parentId,
  options,
  selected,
  allowCreate,
  onSelect,
}: {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  parentId: string | null;
  options: NoteType[];
  selected: NoteType | null;
  allowCreate: boolean;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const name = query.trim();
  const canCreate =
    allowCreate &&
    name.length > 0 &&
    !options.some(
      (option) =>
        option.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    );

  const create = useMutation({
    mutationFn: (nextName: string) =>
      createNoteType({ name: nextName, parentId }),
    onSuccess: (row) => onSelect(row.id),
    onError: (error, nextName) => {
      console.error("[note-types] failed to create", error);
      toast.error(t`Could not create "${nextName}".`);
    },
  });

  const choose = (id: string | null) => {
    setOpen(false);
    setQuery("");
    if (id !== (selected?.id ?? null)) onSelect(id);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-muted-foreground w-16 shrink-0 text-xs">
        {label}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={selected ? `${label}: ${selected.name}` : label}
            className={cn([
              "flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-sm",
              "hover:bg-hover active:bg-pressed",
              selected ? "text-foreground" : "text-muted-foreground",
              open && "bg-pressed",
              focusRingClassName,
            ])}
          >
            <span className="min-w-0 flex-1 truncate">
              {selected?.name ?? placeholder}
            </span>
            <CaretDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          variant="app"
          align="start"
          className="w-56 overflow-hidden"
        >
          <AppFloatingPanel className="overflow-hidden">
            <Command
              filter={filterByName}
              className="rounded-[inherit] border-0 bg-transparent **:[[cmdk-input-wrapper]]:h-8 **:[[cmdk-input-wrapper]]:px-2.5"
            >
              <CommandInput
                placeholder={searchPlaceholder}
                value={query}
                onValueChange={setQuery}
                className="h-8 py-0"
              />
              <CommandList className="max-h-64 p-1">
                <CommandEmpty className="text-muted-foreground px-2.5 py-2 text-left text-sm">
                  {options.length === 0 ? t`Nothing here yet.` : t`No match.`}
                </CommandEmpty>
                {options.length > 0 ? (
                  <CommandGroup>
                    {options.map((option) => (
                      <CommandItem
                        key={option.id}
                        value={`${option.name}\u0000${option.id}`}
                        onSelect={() => choose(option.id)}
                        className="cursor-pointer"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {option.name}
                        </span>
                        {option.id === selected?.id ? (
                          <Check className="size-4 shrink-0" />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
                {canCreate || (selected && !name) ? (
                  <CommandGroup>
                    {canCreate ? (
                      <CommandItem
                        value={`\u0001create ${name}`}
                        disabled={create.isPending}
                        onSelect={() => {
                          setOpen(false);
                          setQuery("");
                          create.mutate(name);
                        }}
                        className="cursor-pointer"
                      >
                        <Plus className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {t`Create "${name}"`}
                        </span>
                      </CommandItem>
                    ) : null}
                    {selected && !name ? (
                      <CommandItem
                        value={"\u0001clear"}
                        onSelect={() => choose(null)}
                        className="text-muted-foreground cursor-pointer"
                      >
                        <X className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {t`Clear`}
                        </span>
                      </CommandItem>
                    ) : null}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </AppFloatingPanel>
        </PopoverContent>
      </Popover>
    </div>
  );
}
