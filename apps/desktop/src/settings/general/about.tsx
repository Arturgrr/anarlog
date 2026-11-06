import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";

import { commands as miscCommands } from "@anlg/plugin-misc";
import { commands as openerCommands } from "@anlg/plugin-opener2";
import { commands as tracingCommands } from "@anlg/plugin-tracing";
import { Badge } from "@anlg/ui/components/ui/badge";
import { Button } from "@anlg/ui/components/ui/button";

import { isBetaVersion, issueFormUrl } from "./feedback";

import { useTabs } from "~/store/zustand/tabs";

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
) {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

export function AboutSettingsView() {
  const openNew = useTabs((state) => state.openNew);
  const device = useQuery({
    queryKey: ["device-info"],
    queryFn: async () => unwrap(await miscCommands.getDeviceInfo(null)),
    staleTime: Infinity,
  });
  const openIssueForm = useMutation({
    mutationFn: async (template: "bug_report.yml" | "feedback.yml") => {
      if (!device.data) return;
      const url = issueFormUrl(template, device.data);
      unwrap(await openerCommands.openUrl(url, null));
    },
  });
  const showLogs = useMutation({
    mutationFn: async () => {
      const directory = unwrap(await tracingCommands.logsDir());
      unwrap(await openerCommands.openPath(directory, null));
    },
  });

  const version = device.data?.appVersion;
  const beta = version ? isBetaVersion(version) : false;

  return (
    <section>
      <h2 className="mb-4 font-sans text-lg font-semibold">
        <Trans>About</Trans>
      </h2>
      <div className="flex flex-col gap-4">
        {version && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">
                <Trans>Librelog {version}</Trans>
              </p>
              {beta && (
                <Badge variant="outline">
                  <Trans>Beta</Trans>
                </Badge>
              )}
            </div>
            {beta && (
              <p className="text-muted-foreground text-xs">
                <Trans>
                  This is a beta, so expect rough edges. Reports open a GitHub
                  issue with your app version, macOS version, and chip filled
                  in; nothing is sent until you submit it.
                </Trans>
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!device.data}
            onClick={() => openIssueForm.mutate("bug_report.yml")}
          >
            <Trans>Report a problem</Trans>
          </Button>
          <Button
            variant="outline"
            disabled={!device.data}
            onClick={() => openIssueForm.mutate("feedback.yml")}
          >
            <Trans>Send feedback</Trans>
          </Button>
          <Button variant="outline" onClick={() => showLogs.mutate()}>
            <Trans>Show log files</Trans>
          </Button>
          <Button
            variant="outline"
            disabled={!version}
            onClick={() => {
              if (version) {
                openNew({
                  type: "changelog",
                  state: { current: version, previous: version },
                });
              }
            }}
          >
            <Trans>Show release notes</Trans>
          </Button>
        </div>
        {(openIssueForm.isError || showLogs.isError) && (
          <p className="text-danger text-xs" role="alert">
            <Trans>Librelog could not open that. Try again.</Trans>
          </p>
        )}
      </div>
    </section>
  );
}
