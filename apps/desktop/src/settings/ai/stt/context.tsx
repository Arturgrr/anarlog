import { t } from "@lingui/core/macro";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import {
  commands as localSttCommands,
  type LocalModel,
} from "@anlg/plugin-local-stt";
import { toast } from "@anlg/ui/components/ui/toast";

import { useNotifications } from "~/contexts/notifications";
import { setSettingValues } from "~/settings/queries";
import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";

type SttSettingsContextType = {
  startDownload: (model: LocalModel, provider: string) => void;
  cancelDownload: (model: LocalModel) => Promise<void>;
  queuedDownloads: LocalModel[];
};

const SttSettingsContext = createContext<SttSettingsContextType | null>(null);

const DOWNLOAD_PROGRESS_GRACE_MS = 10_000;

export function SttSettingsProvider({
  selectOnDownload = false,
  children,
}: {
  selectOnDownload?: boolean;
  children: React.ReactNode;
}) {
  const { dismissDownload } = useNotifications();
  const [queuedDownloads, setQueuedDownloads] = useState<LocalModel[]>([]);
  const queuedDownloadsRef = useRef<Set<LocalModel>>(new Set());

  const dequeue = useCallback((model: LocalModel) => {
    queuedDownloadsRef.current.delete(model);
    setQueuedDownloads([...queuedDownloadsRef.current]);
  }, []);

  const clearPendingDownload = useCallback((model: LocalModel) => {
    usePendingSttSelection.setState((state) => ({
      queuedDownloads: state.queuedDownloads.filter(
        (queued) => queued !== model,
      ),
      selection: state.selection?.model === model ? null : state.selection,
    }));
  }, []);

  const startDownload = useCallback(
    (model: LocalModel, provider: string) => {
      if (queuedDownloadsRef.current.has(model)) {
        return;
      }

      queuedDownloadsRef.current.add(model);
      setQueuedDownloads([...queuedDownloadsRef.current]);
      // Selecting first: saving a transcription choice drops the pending one,
      // so it has to happen before the pending selection below is set.
      if (selectOnDownload) {
        void setSettingValues({
          current_stt_provider: provider,
          current_stt_model: model,
        }).catch((error) => {
          console.error(
            "[settings] failed to select the downloading model",
            error,
          );
        });
      }
      const selection = { provider, model };
      usePendingSttSelection.setState((state) => {
        const { [model]: _, ...failedDownloads } = state.failedDownloads;
        return {
          selection,
          queuedDownloads: [
            ...state.queuedDownloads.filter((queued) => queued !== model),
            model,
          ],
          failedDownloads,
        };
      });
      const failToStart = (description: string) => {
        toast.error(t`Model download couldn’t start`, { description });
        dequeue(model);
        usePendingSttSelection.setState((state) => ({
          queuedDownloads: state.queuedDownloads.filter(
            (queued) => queued !== model,
          ),
          selection: state.selection === selection ? null : state.selection,
          failedDownloads: { ...state.failedDownloads, [model]: description },
        }));
      };
      void (async () => {
        try {
          const result = await localSttCommands.downloadModel(model);
          if (result.status === "error") {
            failToStart(result.error);
            return;
          }
        } catch (error) {
          failToStart(error instanceof Error ? error.message : String(error));
          return;
        }

        // The command resolves when the download starts, not when it finishes.
        // Keep the queue entry until progress events take over the row state,
        // so the gap cannot accept another click.
        setTimeout(() => dequeue(model), DOWNLOAD_PROGRESS_GRACE_MS);
      })();
    },
    [dequeue, selectOnDownload],
  );

  const cancelDownload = useCallback(
    async (model: LocalModel) => {
      const result = await localSttCommands.cancelDownload(model);
      if (result.status === "error") {
        throw new Error(result.error);
      }

      dequeue(model);
      clearPendingDownload(model);
      dismissDownload(model);
    },
    [clearPendingDownload, dequeue, dismissDownload],
  );

  return (
    <SttSettingsContext.Provider
      value={{ startDownload, cancelDownload, queuedDownloads }}
    >
      {children}
    </SttSettingsContext.Provider>
  );
}

export function useSttSettings() {
  const context = useContext(SttSettingsContext);
  if (!context) {
    throw new Error("useSttSettings must be used within SttSettingsProvider");
  }
  return context;
}
