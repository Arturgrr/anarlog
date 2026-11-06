import {
  AppFloatingPanel,
  PopoverContent,
} from "@anlg/ui/components/ui/popover";

import { DateEditor } from "./date";
import { ParticipantsDisplay } from "./participants";

export function MetadataPopoverContent({ sessionId }: { sessionId: string }) {
  return (
    <PopoverContent variant="app" align="end" className="w-72 overflow-hidden">
      <MetadataPanelContent sessionId={sessionId} />
    </PopoverContent>
  );
}

export function MetadataPanelContent({ sessionId }: { sessionId: string }) {
  return (
    <AppFloatingPanel className="scrollbar-hide max-h-[80vh] min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain">
      <ContentInner sessionId={sessionId} />
    </AppFloatingPanel>
  );
}

function ContentInner({ sessionId }: { sessionId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <DateEditor sessionId={sessionId} />
      <ParticipantsDisplay sessionId={sessionId} />
    </div>
  );
}
