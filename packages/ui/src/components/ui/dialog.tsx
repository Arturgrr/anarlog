import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

import { X } from "../icons";
import { useUiLabels } from "./labels";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  showOverlay?: boolean;
  overlayClassName?: string;
  overlayChildren?: React.ReactNode;
};

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-dialog-overlay
    className={cn([
      "bg-scrim data-[state=open]:animate-scrim-in data-[state=closed]:animate-scrim-out fixed inset-0 z-50",
      className,
    ])}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      showOverlay = true,
      overlayClassName,
      overlayChildren,
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      {showOverlay ? (
        <DialogOverlay className={overlayClassName}>
          {overlayChildren}
        </DialogOverlay>
      ) : null}
      <DialogPrimitive.Content
        ref={ref}
        className={cn([
          "bg-layer-1 text-foreground shadow-overlay data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-md p-4 outline-hidden",
          className,
        ])}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn([
            focusRingClassName,
            "text-icon-muted hover:bg-hover hover:text-icon active:bg-pressed absolute top-3 right-3 flex size-5 items-center justify-center rounded-sm disabled:pointer-events-none",
          ])}
        >
          <X className="size-3.5" />
          <CloseLabel />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

function CloseLabel() {
  return <span className="sr-only">{useUiLabels().close}</span>;
}

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn([
      "flex flex-col gap-1.5 text-center sm:text-left",
      className,
    ])}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn([
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className,
    ])}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(["text-body font-ui-medium text-foreground", className])}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(["text-muted-foreground text-ui", className])}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
