import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { CaretDown } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@anlg/ui/components/ui/popover";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { cn } from "@anlg/utils";

import {
  planSpeakerAssignments,
  toSpeakerAssignmentCall,
} from "./assign-speakers";

import {
  SpeakerParticipantPicker,
  type SpeakerParticipantOption,
  useSpeakerParticipantOptions,
} from "~/session/components/note-input/transcript/renderer/speaker-assign";
import {
  GlassDialogCancelButton,
  GlassDialogContent,
} from "~/shared/ui/glass-dialog";
import {
  assignSessionTranscriptSpeaker,
  assignTranscriptSpeaker,
} from "~/stt/queries";
import {
  areAllSpeakersNamed,
  type SessionSpeaker,
  useSessionSpeakersState,
} from "~/stt/session-speakers";

export function AssignSpeakersDialog({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const { speakers, isLoading } = useSessionSpeakersState(sessionId);
  const { participants, contacts, resolveHumanId } =
    useSpeakerParticipantOptions(sessionId);

  const nameByHumanId = useMemo(
    () =>
      new Map(
        [...contacts, ...participants].map(
          (option) => [option.id, option.name] as const,
        ),
      ),
    [contacts, participants],
  );
  const transcriptNumbers = useMemo(() => {
    const ids = [...new Set(speakers.map((speaker) => speaker.transcriptId))];
    return ids.length > 1
      ? new Map(ids.map((id, index) => [id, index + 1] as const))
      : null;
  }, [speakers]);

  // A person created for a "new" choice must survive a retry after a partial
  // failure, or the retry would create them again.
  const resolvedHumanIds = useRef(new Map<string, string>());

  const apply = useMutation({
    // Rows are applied one at a time: transcript writes are optimistically
    // locked on the content revision.
    mutationFn: async ({
      rows,
      choices,
    }: {
      rows: SessionSpeaker[];
      choices: Record<string, SpeakerParticipantOption>;
    }) => {
      for (const step of planSpeakerAssignments(rows, choices)) {
        try {
          const choiceKey = step.choice.isNew
            ? `new:${step.choice.name.trim().toLowerCase()}`
            : step.choice.id;
          const humanId =
            resolvedHumanIds.current.get(choiceKey) ??
            (await resolveHumanId(step.choice));
          if (!humanId) {
            throw new Error("Could not resolve the chosen person");
          }
          resolvedHumanIds.current.set(choiceKey, humanId);

          const call = toSpeakerAssignmentCall({ sessionId, humanId, step });
          await (call.kind === "speaker"
            ? assignSessionTranscriptSpeaker(call.args)
            : assignTranscriptSpeaker(call.args));
        } catch (error) {
          console.error("[assign-speakers] failed to assign speaker", error);
          const failedLabel = step.speaker.label;
          throw new Error(
            t`Could not assign ${failedLabel}. Speakers listed before it were saved; try again to finish.`,
          );
        }
      }
    },
    onSuccess: () => onOpenChange(false),
  });

  const form = useForm({
    defaultValues: {
      choices: {} as Record<string, SpeakerParticipantOption>,
    },
    onSubmit: ({ value }) =>
      apply.mutate({ rows: speakers, choices: value.choices }),
  });

  const allNamed = areAllSpeakersNamed(speakers);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!apply.isPending) onOpenChange(nextOpen);
      }}
    >
      <GlassDialogContent className="max-w-[480px]">
        <DialogHeader className="gap-1 text-left sm:text-left">
          <DialogTitle className="text-foreground text-[13px] leading-5 font-semibold tracking-normal">
            <Trans>Assign speakers</Trans>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {allNamed ? (
              <Trans>
                Every speaker has a person. You can still change who they are.
              </Trans>
            ) : (
              <Trans>
                Choose a person for each speaker. All of that speaker's lines
                will be marked as them.
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          {isLoading && speakers.length === 0 ? (
            <div
              role="status"
              className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs"
            >
              <Spinner size={12} />
              <Trans>Loading speakers…</Trans>
            </div>
          ) : speakers.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">
              <Trans>This transcript has no speakers to assign.</Trans>
            </p>
          ) : (
            <form.Subscribe selector={(state) => state.values.choices}>
              {(choices) => (
                <ul
                  className={cn([
                    "-mx-4 max-h-[min(60vh,420px)] overflow-y-auto px-4",
                    "divide-border divide-y",
                  ])}
                >
                  {speakers.map((speaker) => (
                    <SpeakerRow
                      key={speaker.key}
                      sessionId={sessionId}
                      speaker={speaker}
                      transcriptNumber={
                        transcriptNumbers?.get(speaker.transcriptId) ?? null
                      }
                      choice={choices[speaker.key] ?? null}
                      currentName={
                        speaker.humanId
                          ? (nameByHumanId.get(speaker.humanId) ??
                            speaker.label)
                          : null
                      }
                      disabled={apply.isPending}
                      onPick={(option) =>
                        form.setFieldValue("choices", (previous) => ({
                          ...previous,
                          [speaker.key]: option,
                        }))
                      }
                    />
                  ))}
                </ul>
              )}
            </form.Subscribe>
          )}

          {apply.error && (
            <p role="alert" className="text-destructive text-xs">
              {apply.error.message}
            </p>
          )}

          <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:justify-normal">
            <GlassDialogCancelButton
              disabled={apply.isPending}
              onClick={() => onOpenChange(false)}
            >
              <Trans>Cancel</Trans>
            </GlassDialogCancelButton>
            <form.Subscribe selector={(state) => state.values.choices}>
              {(choices) => (
                <Button
                  type="submit"
                  className="h-7 px-3"
                  disabled={
                    apply.isPending ||
                    planSpeakerAssignments(speakers, choices).length === 0
                  }
                >
                  {apply.isPending ? (
                    <Trans>Applying…</Trans>
                  ) : (
                    <Trans>Apply</Trans>
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </GlassDialogContent>
    </Dialog>
  );
}

function SpeakerRow({
  sessionId,
  speaker,
  transcriptNumber,
  choice,
  currentName,
  disabled,
  onPick,
}: {
  sessionId: string;
  speaker: SessionSpeaker;
  transcriptNumber: number | null;
  choice: SpeakerParticipantOption | null;
  currentName: string | null;
  disabled: boolean;
  onPick: (option: SpeakerParticipantOption) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const changed =
    choice !== null && (!!choice.isNew || choice.id !== speaker.humanId);
  const personName = choice?.name ?? currentName;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-foreground truncate text-[13px] font-medium">
            {speaker.label}
          </span>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {transcriptNumber !== null && (
              <>
                <Trans>Recording {transcriptNumber}</Trans>
                {" · "}
              </>
            )}
            <Plural value={speaker.wordCount} one="# word" other="# words" />
          </span>
        </div>
        {speaker.sample && (
          <p className="text-muted-foreground line-clamp-2 text-xs">
            “{speaker.sample}”
          </p>
        )}
      </div>
      {speaker.isSelf ? (
        <span className="text-muted-foreground w-36 shrink-0 px-2 text-xs">
          <Trans>You</Trans>
        </span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !speaker.anchorWordId}
              aria-label={
                personName
                  ? t`Person for ${speaker.label}: ${personName}`
                  : t`Choose a person for ${speaker.label}`
              }
              className={cn([
                "w-36 shrink-0 justify-between gap-1 px-2 text-xs",
                personName ? "text-foreground" : "text-muted-foreground",
                changed && "font-medium",
              ])}
            >
              <span className="truncate">
                {personName ?? <Trans>Choose person</Trans>}
              </span>
              <CaretDown className="text-icon-muted size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            variant="app"
            align="end"
            sideOffset={4}
            collisionPadding={16}
            className="w-72"
          >
            <SpeakerParticipantPicker
              sessionId={sessionId}
              showAssignmentScope={false}
              pickedId={choice?.id ?? speaker.humanId}
              onPick={(option) => {
                onPick(option);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </li>
  );
}
