import { Trans } from "@lingui/react/macro";

import { Plus } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";

import { AutoTemplateDetails } from "./auto-form";
import { type UserTemplate } from "./queries";
import { TemplateForm } from "./template-form";

export function TemplateDetailsColumn({
  isAutoSelected,
  selectedMineTemplate,
  handleCreateTemplate,
  handleDeleteTemplate,
  handleDuplicateTemplate,
}: {
  isAutoSelected: boolean;
  selectedMineTemplate: UserTemplate | null;
  handleCreateTemplate: () => void;
  handleDeleteTemplate: (id: string) => void;
  handleDuplicateTemplate: (id: string) => void;
}) {
  if (isAutoSelected) {
    return <AutoTemplateDetails />;
  }

  if (!selectedMineTemplate) {
    return <TemplateDetailEmpty onCreate={handleCreateTemplate} />;
  }

  return (
    <TemplateForm
      key={selectedMineTemplate.id}
      template={selectedMineTemplate}
      handleDeleteTemplate={handleDeleteTemplate}
      handleDuplicateTemplate={handleDuplicateTemplate}
    />
  );
}

function TemplateDetailEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-muted-foreground text-sm">
        <Trans>No templates yet</Trans>
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onCreate}
        className="gap-2"
      >
        <Plus className="size-4" />
        <Trans>Create template</Trans>
      </Button>
    </div>
  );
}
