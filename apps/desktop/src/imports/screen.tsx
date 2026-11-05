import { Trans, useLingui } from "@lingui/react/macro";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { open as selectFiles } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useEffect, useRef } from "react";

import { commands as importerCommands } from "@anlg/plugin-importer";
import {
  ArrowsClockwise,
  CaretDown,
  CircleNotch,
  DownloadSimple,
  PlugsConnected,
} from "@anlg/ui/components/icons";
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTriggerPrimitive,
  AccordionContent,
} from "@anlg/ui/components/ui/accordion";
import { Button } from "@anlg/ui/components/ui/button";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { cn } from "@anlg/utils";

import {
  cancelConnectedImport,
  connectConnectedImport,
  connectedImportCredentialsQueryKey,
  connectedImportCredentialsQueryOptions,
  connectedImportSyncQueryKey,
  connectedImportSyncQueryOptions,
  disconnectConnectedImport,
  isDirectMeetingImport,
} from "./connected-import";
import { detectImportSources } from "./detection";
import { providerIconOpticalClass, providerIconSrc } from "./icons";
import type {
  DetectedMeetingImportProvider,
  MeetingImportProvider,
} from "./providers";
import {
  EMPTY_MEETING_IMPORT_HISTORY,
  importMeetingFiles,
  useMeetingImportHistory,
} from "./queries";

import { ConnectButtonGroup } from "~/shared/connect-button-group";

const IMPORT_EXTENSIONS = [
  "csv",
  "json",
  "md",
  "markdown",
  "srt",
  "txt",
  "vtt",
];

function ProviderIcon({
  provider,
}: {
  provider: DetectedMeetingImportProvider;
}) {
  const src = providerIconSrc(provider);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn([
          "size-8 object-contain object-center",
          providerIconOpticalClass(provider),
        ])}
      />
    );
  }

  return (
    <span
      className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg text-xs font-semibold"
      aria-hidden="true"
    >
      {provider.name.charAt(0)}
    </span>
  );
}

export function MeetingImportScreen({
  compact = false,
  onContinue,
  onNoSourcesDetected,
  secondaryAction,
}: {
  compact?: boolean;
  onContinue?: () => void;
  onNoSourcesDetected?: () => void;
  secondaryAction?: ReactNode;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const connectAbortController = useRef<AbortController | null>(null);
  const detectionQuery = useQuery({
    queryKey: ["meeting-import-sources"],
    queryFn: detectImportSources,
    refetchOnMount: "always",
  });
  const historyQuery = useMeetingImportHistory();
  const history = historyQuery.data ?? EMPTY_MEETING_IMPORT_HISTORY;
  const detectedProviders = detectionQuery.data ?? [];
  const connectedProviders = detectedProviders
    .filter((provider) => isDirectMeetingImport(provider))
    .sort((left, right) => left.name.localeCompare(right.name));
  const fileProviders = detectedProviders
    .filter((provider) => !provider.directImport)
    .sort((left, right) => left.name.localeCompare(right.name));
  const displayedProviders = [...connectedProviders, ...fileProviders];
  const detectionSettled = !detectionQuery.isLoading && !detectionQuery.error;

  useEffect(() => {
    if (
      detectionQuery.isFetching ||
      detectionQuery.error ||
      detectionQuery.data?.length !== 0
    ) {
      return;
    }

    onNoSourcesDetected?.();
  }, [
    detectionQuery.data,
    detectionQuery.error,
    detectionQuery.isFetching,
    onNoSourcesDetected,
  ]);

  const credentialQueries = useQueries({
    queries: connectedProviders.map((provider) =>
      connectedImportCredentialsQueryOptions(provider.id),
    ),
  });
  const syncQueries = useQueries({
    queries: connectedProviders.map((provider, index) =>
      connectedImportSyncQueryOptions(
        provider,
        Boolean(credentialQueries[index]?.data),
      ),
    ),
  });
  const connectedProviderIndexes = new Map(
    connectedProviders.map((provider, index) => [provider.id, index]),
  );

  const fileImportMutation = useMutation({
    mutationFn: async (provider: MeetingImportProvider) => {
      const selection = await selectFiles({
        title: t`Choose ${provider.name} export files`,
        multiple: true,
        directory: false,
        filters: [
          {
            name: t`Meeting exports`,
            extensions: IMPORT_EXTENSIONS,
          },
        ],
      });
      const paths = Array.isArray(selection)
        ? selection
        : selection
          ? [selection]
          : [];
      if (paths.length === 0) return null;

      const filesResult = await importerCommands.readTextFiles(paths);
      if (filesResult.status === "error") throw new Error(filesResult.error);
      const result = await importMeetingFiles(provider.id, filesResult.data);
      return { ...result, completedAt: Date.now() };
    },
  });

  const connectMutation = useMutation({
    mutationFn: async (provider: MeetingImportProvider) => {
      const controller = new AbortController();
      connectAbortController.current = controller;
      try {
        return await connectConnectedImport(provider, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return null;
        throw error;
      } finally {
        if (connectAbortController.current === controller) {
          connectAbortController.current = null;
        }
      }
    },
    onSuccess: async (result) => {
      if (!result) return;
      queryClient.setQueryData(
        connectedImportCredentialsQueryKey(result.providerId),
        result,
      );
    },
  });

  const cancelConnectMutation = useMutation({
    mutationFn: cancelConnectedImport,
  });

  const disconnectMutation = useMutation({
    mutationFn: (input: { providerId: string }) =>
      disconnectConnectedImport(input.providerId),
    onSuccess: async (_, input) => {
      queryClient.setQueryData(
        connectedImportCredentialsQueryKey(input.providerId),
        null,
      );
      await queryClient.cancelQueries({
        queryKey: connectedImportSyncQueryKey(input.providerId),
      });
      queryClient.removeQueries({
        queryKey: connectedImportSyncQueryKey(input.providerId),
      });
    },
  });

  const latestResult =
    fileImportMutation.data ??
    syncQueries.find((query) => query.data)?.data?.result ??
    null;

  return (
    <div className={cn(["flex flex-col gap-4", compact && "max-w-3xl"])}>
      {detectionQuery.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <CircleNotch className="size-3.5 animate-spin" />
          <Trans>Checking installed meeting assistants…</Trans>
        </p>
      ) : detectionQuery.error ? (
        <p className="text-destructive text-xs">
          {detectionQuery.error.message}
        </p>
      ) : null}

      {displayedProviders.length > 0 || detectionSettled ? (
        <div className="border-border bg-card overflow-hidden rounded-2xl border">
          <Accordion
            type="multiple"
            className={cn([
              "divide-border divide-y",
              compact && "max-h-80 overflow-y-auto",
            ])}
          >
            {displayedProviders.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                <Trans>No apps found.</Trans>
              </p>
            ) : (
              displayedProviders.map((provider) => {
                const importing =
                  fileImportMutation.isPending &&
                  fileImportMutation.variables.id === provider.id;
                const connectedProvider = isDirectMeetingImport(provider);
                const connectedIndex = connectedProviderIndexes.get(
                  provider.id,
                );
                const credentialsQuery =
                  connectedIndex === undefined
                    ? undefined
                    : credentialQueries[connectedIndex];
                const syncQuery =
                  connectedIndex === undefined
                    ? undefined
                    : syncQueries[connectedIndex];
                const connected = Boolean(credentialsQuery?.data);
                const checkingConnection = Boolean(credentialsQuery?.isPending);
                const connecting =
                  connectMutation.isPending &&
                  connectMutation.variables.id === provider.id;
                const connectionCancellationRequested =
                  connecting &&
                  Boolean(connectAbortController.current?.signal.aborted);
                const cancellingConnection =
                  cancelConnectMutation.isPending &&
                  cancelConnectMutation.variables === provider.id;
                const disconnecting =
                  disconnectMutation.isPending &&
                  disconnectMutation.variables?.providerId === provider.id;
                const lastRun = history.find(
                  (run) => run.providerId === provider.id,
                );

                const result =
                  fileImportMutation.variables?.id === provider.id &&
                  fileImportMutation.data &&
                  fileImportMutation.data.completedAt >=
                    (syncQuery?.dataUpdatedAt ?? 0)
                    ? fileImportMutation.data
                    : syncQuery?.data?.result;
                const error =
                  credentialsQuery?.error ??
                  syncQuery?.error ??
                  (fileImportMutation.variables?.id === provider.id
                    ? fileImportMutation.error
                    : null) ??
                  (connectMutation.variables?.id === provider.id
                    ? connectMutation.error
                    : null) ??
                  (cancelConnectMutation.variables === provider.id
                    ? cancelConnectMutation.error
                    : null) ??
                  (disconnectMutation.variables?.providerId === provider.id
                    ? disconnectMutation.error
                    : null);

                return (
                  <AccordionItem
                    key={provider.id}
                    value={provider.id}
                    role="group"
                    aria-label={provider.name}
                    className="border-0"
                  >
                    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
                      <AccordionHeader className="min-w-0 flex-1">
                        <AccordionTriggerPrimitive className="group focus-visible:outline-ring flex w-full items-center gap-3 text-left">
                          <span className="flex size-8 shrink-0 items-center justify-center">
                            <ProviderIcon provider={provider} />
                          </span>
                          <span className="truncate text-sm font-medium">
                            {provider.name}
                          </span>
                          <CaretDown className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                        </AccordionTriggerPrimitive>
                      </AccordionHeader>
                      {connectedProvider ? (
                        <div className="flex shrink-0 items-center gap-1">
                          {connected ? (
                            <ConnectButtonGroup
                              primary
                              busy={syncQuery?.isFetching}
                              busyLabel={t`Sync now`}
                            >
                              <Button
                                type="button"
                                size="sm"
                                smoothCorners={false}
                                aria-label={t`Sync now`}
                                className="group/sync hover:bg-primary-foreground/10 rounded-none border-0 bg-transparent shadow-none"
                                disabled={
                                  syncQuery?.isFetching || disconnecting
                                }
                                aria-busy={syncQuery?.isFetching}
                                onClick={() =>
                                  void syncQuery?.refetch({
                                    cancelRefetch: false,
                                  })
                                }
                              >
                                {syncQuery?.isFetching ? (
                                  <CircleNotch className="size-3.5 animate-spin" />
                                ) : (
                                  <ArrowsClockwise className="size-3.5" />
                                )}
                                <span aria-hidden="true" className="grid">
                                  <span className="col-start-1 row-start-1 group-hover/sync:invisible group-focus-visible/sync:invisible">
                                    <Trans>Connected</Trans>
                                  </span>
                                  <span className="invisible col-start-1 row-start-1 group-hover/sync:visible group-focus-visible/sync:visible">
                                    <Trans>Sync now</Trans>
                                  </span>
                                </span>
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    size="sm"
                                    smoothCorners={false}
                                    aria-label={t`More options`}
                                    disabled={
                                      syncQuery?.isFetching || disconnecting
                                    }
                                    className={cn([
                                      "relative w-6 rounded-none border-0 px-0 shadow-none",
                                      "before:absolute before:inset-y-1.5 before:left-0 before:w-px",
                                      "hover:bg-primary-foreground/10 before:bg-primary-foreground/20 bg-transparent",
                                    ])}
                                  >
                                    <CaretDown className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  variant="app"
                                  align="end"
                                  className="w-40"
                                >
                                  <AppFloatingPanel
                                    className={appFloatingMenuPanelClassName}
                                  >
                                    <DropdownMenuItem
                                      disabled={
                                        syncQuery?.isFetching || disconnecting
                                      }
                                      onClick={() =>
                                        disconnectMutation.mutate({
                                          providerId: provider.id,
                                        })
                                      }
                                    >
                                      <Trans>Disconnect</Trans>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={fileImportMutation.isPending}
                                      onClick={() =>
                                        fileImportMutation.mutate(provider)
                                      }
                                    >
                                      <DownloadSimple />
                                      <Trans>Use files</Trans>
                                    </DropdownMenuItem>
                                  </AppFloatingPanel>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </ConnectButtonGroup>
                          ) : (
                            <ConnectButtonGroup primary>
                              <Button
                                type="button"
                                size="sm"
                                smoothCorners={false}
                                disabled={
                                  checkingConnection ||
                                  cancelConnectMutation.isPending ||
                                  connectionCancellationRequested ||
                                  (connectMutation.isPending && !connecting)
                                }
                                className={cn([
                                  "rounded-none border-0 shadow-none",
                                  "hover:bg-primary-foreground/10 bg-transparent",
                                ])}
                                onClick={() => {
                                  if (connecting) {
                                    connectAbortController.current?.abort();
                                    cancelConnectMutation.mutate(provider.id);
                                    return;
                                  }
                                  connectMutation.mutate(provider);
                                }}
                              >
                                {checkingConnection ||
                                connecting ||
                                cancellingConnection ? (
                                  <CircleNotch className="size-3.5 animate-spin" />
                                ) : (
                                  <PlugsConnected className="size-3.5" />
                                )}
                                {connecting || cancellingConnection ? (
                                  <Trans>Cancel</Trans>
                                ) : checkingConnection ? (
                                  <Trans>Checking connection</Trans>
                                ) : (
                                  <Trans>Connect</Trans>
                                )}
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    size="sm"
                                    smoothCorners={false}
                                    aria-label={t`Use files`}
                                    disabled={fileImportMutation.isPending}
                                    className={cn([
                                      "relative w-6 rounded-none border-0 px-0 shadow-none",
                                      "before:absolute before:inset-y-1.5 before:left-0 before:w-px",
                                      "hover:bg-primary-foreground/10 before:bg-primary-foreground/20 bg-transparent",
                                    ])}
                                  >
                                    <CaretDown className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  variant="app"
                                  align="end"
                                  className="w-40"
                                >
                                  <AppFloatingPanel
                                    className={appFloatingMenuPanelClassName}
                                  >
                                    <DropdownMenuItem
                                      onClick={() =>
                                        fileImportMutation.mutate(provider)
                                      }
                                    >
                                      <DownloadSimple />
                                      <Trans>Use files</Trans>
                                    </DropdownMenuItem>
                                  </AppFloatingPanel>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </ConnectButtonGroup>
                          )}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          className="w-40 shrink-0"
                          variant="outline"
                          disabled={fileImportMutation.isPending}
                          onClick={() => fileImportMutation.mutate(provider)}
                        >
                          {importing ? (
                            <CircleNotch className="size-3.5 animate-spin" />
                          ) : (
                            <DownloadSimple className="size-3.5" />
                          )}
                          <Trans>Choose files</Trans>
                        </Button>
                      )}
                    </div>
                    <AccordionContent className="px-4 pb-4 pl-15">
                      {connected ? (
                        <p className="text-muted-foreground text-xs">
                          <Trans>
                            New meetings are imported automatically while
                            Anarlog is running.
                          </Trans>
                        </p>
                      ) : null}
                      {lastRun && !result ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          <Trans>
                            Last import: {lastRun.imported} added,{" "}
                            {lastRun.matched} unchanged
                          </Trans>
                        </p>
                      ) : null}
                      {!result && !lastRun && !error ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          <Trans>No imports yet.</Trans>
                        </p>
                      ) : null}
                      {result ? (
                        <p
                          className="text-muted-foreground mt-1 text-xs"
                          role="status"
                        >
                          {result.errors > 0 || result.conflicts > 0 ? (
                            <Trans>
                              Imported: {result.imported}. Unchanged:{" "}
                              {result.matched}. Needs review: {result.conflicts}
                              . Failed: {result.errors}.
                            </Trans>
                          ) : (
                            <Trans>
                              Last import: {result.imported} added,{" "}
                              {result.matched} unchanged
                            </Trans>
                          )}
                        </p>
                      ) : null}
                      {syncQuery?.data?.warnings.map((warning) => (
                        <p
                          key={warning}
                          className="text-muted-foreground mt-1 text-xs"
                          role="status"
                        >
                          {warning}
                        </p>
                      ))}
                      {error ? (
                        <p
                          className="text-destructive mt-1 text-xs"
                          role="alert"
                        >
                          {error.message}
                        </p>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                );
              })
            )}
          </Accordion>
        </div>
      ) : null}

      {secondaryAction || (onContinue && latestResult) ? (
        <div className="flex items-center gap-3">
          {onContinue && latestResult ? (
            <Button
              type="button"
              className="w-fit rounded-full"
              onClick={onContinue}
            >
              <Trans>Continue</Trans>
            </Button>
          ) : null}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
