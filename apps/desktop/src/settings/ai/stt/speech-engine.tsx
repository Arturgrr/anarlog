import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@anlg/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import { DetailSection } from "~/settings/ai/shared/provider-detail";
import { restartLocalSttEngine, setSettingValue } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";
import { ggufCommands, type SttDevicePreference } from "~/stt/gguf";

const STT_DEVICES_QUERY_KEY = ["local-stt", "devices"] as const;

export function SpeechEngineSection() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const stored = useConfigValue("local_stt_device");
  const preference: SttDevicePreference =
    stored === "gpu" || stored === "cpu" ? stored : "auto";

  const devices = useQuery({
    queryKey: STT_DEVICES_QUERY_KEY,
    queryFn: async () => {
      const result = await ggufCommands.listSttDevices();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return result.data;
    },
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: STT_DEVICES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["stt-connection"] }),
    ]);
  const choose = useMutation({
    mutationFn: async (device: SttDevicePreference) => {
      await setSettingValue("local_stt_device", device);
      await restartLocalSttEngine();
    },
    onSettled: refresh,
  });
  const retryGpu = useMutation({
    mutationFn: async () => {
      const result = await ggufCommands.forgetSttGpuFailures();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      await restartLocalSttEngine();
    },
    onSettled: refresh,
  });

  const allDevices = devices.data ?? [];
  if (!allDevices.some((device) => device.kind === "gpu")) {
    return null;
  }

  const setAside =
    preference === "auto"
      ? allDevices.find((device) => device.kind === "gpu" && device.failed)
      : undefined;
  const setAsideName = setAside?.name;
  const error = choose.error ?? retryGpu.error;

  return (
    <DetailSection title={<Trans>Speech engine</Trans>}>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={preference}
          disabled={choose.isPending}
          onValueChange={(value) => choose.mutate(value as SttDevicePreference)}
        >
          <SelectTrigger aria-label={t`Speech engine`} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              <Trans>Auto</Trans>
            </SelectItem>
            <SelectItem value="gpu">
              <Trans>GPU</Trans>
            </SelectItem>
            <SelectItem value="cpu">
              <Trans>CPU</Trans>
            </SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground min-w-0 flex-1 text-xs">
          <Trans>
            Auto uses a GPU that works and falls back to the CPU. Changes apply
            the next time the model loads.
          </Trans>
        </span>
      </div>
      <ul aria-label={t`Devices`} className="text-faint flex flex-col text-xs">
        {allDevices.map((device) => (
          <li key={device.id}>
            {device.name} · {device.backend}
            {device.failed ? (
              <>
                {" · "}
                <Trans>set aside after a failure</Trans>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {setAsideName ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground min-w-0 flex-1">
            <Trans>
              Auto uses the CPU because {setAsideName} stopped responding.
            </Trans>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={retryGpu.isPending}
            onClick={() => retryGpu.mutate()}
          >
            <Trans>Try GPU again</Trans>
          </Button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className="text-danger text-xs">
          {error.message}
        </span>
      ) : null}
    </DetailSection>
  );
}
