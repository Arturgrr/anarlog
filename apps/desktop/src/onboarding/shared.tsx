import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import {
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  XCircle,
} from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

const SCROLL_DELAY_MS = 350;

export type SectionStatus = "completed" | "active" | "upcoming";

export function OnboardingSection({
  title,
  completedTitle,
  description,
  status,
  onBack,
  onNext,
  onSkip,
  skippable = true,
  children,
}: {
  title: ReactNode;
  completedTitle?: ReactNode;
  description?: ReactNode;
  status: SectionStatus | null;
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  skippable?: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const sectionRef = useRef<HTMLElement>(null);

  const isActive = status === "active";
  const isCompleted = status === "completed";

  useEffect(() => {
    if (!isActive) return;
    const timeout = setTimeout(() => {
      sectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, SCROLL_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [isActive]);

  if (!status || status === "upcoming") return null;

  return (
    <section ref={sectionRef}>
      <div
        className={cn([
          "flex items-center gap-2 transition-all duration-300",
          isActive && "mb-3 pt-4",
        ])}
      >
        {isCompleted && (
          <Check className="text-foreground size-4 shrink-0" weight="bold" />
        )}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2
              className={cn([
                "transition-all duration-300",
                isCompleted
                  ? "text-muted-foreground/70 text-xs font-normal"
                  : "text-foreground font-sans text-xl font-semibold",
              ])}
            >
              {isCompleted ? (completedTitle ?? title) : title}
            </h2>
            {isActive && (
              <div className="flex items-center gap-2">
                {import.meta.env.DEV && onBack && (
                  <button
                    onClick={onBack}
                    aria-label={t`Go to previous section`}
                    className="text-muted-foreground hover:text-muted-foreground rounded p-0.5 transition-colors"
                  >
                    <CaretLeft className="size-3" />
                  </button>
                )}
                {onNext &&
                  (skippable ? (
                    <button
                      onClick={() => {
                        if (onSkip) {
                          onSkip();
                        } else {
                          onNext?.();
                        }
                      }}
                      className="text-muted-foreground hover:text-muted-foreground flex items-center gap-1 text-sm transition-colors"
                    >
                      <Trans>Skip</Trans>
                      <CaretRight className="size-3" />
                    </button>
                  ) : import.meta.env.DEV ? (
                    <button
                      onClick={onNext}
                      aria-label={t`Go to next section`}
                      className="text-muted-foreground hover:text-muted-foreground rounded p-0.5 transition-colors"
                    >
                      <CaretRight className="size-3" />
                    </button>
                  ) : null)}
              </div>
            )}
          </div>
          {isActive && description && (
            <div className="text-muted-foreground text-sm">{description}</div>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isActive && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="-mx-5 -mb-5 overflow-hidden px-5 pt-3 pb-5"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function OnboardingButton({
  variant = "primary",
  className,
  ...props
}: {
  variant?: "primary" | "secondary" | "ghost";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn([
        "w-fit rounded-lg px-6 py-2.5 text-sm font-medium transition-[background-color,color,opacity] duration-200 ease-out",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-button-contrast hover:bg-primary/90 disabled:opacity-40",
        variant === "secondary" &&
          "bg-button-neutral text-foreground shadow-button-neutral hover:bg-layer-2 disabled:opacity-50",
        variant === "ghost" &&
          "text-muted-foreground hover:text-muted-foreground",
        className,
      ])}
    />
  );
}

export function StepRow({
  status,
  label,
}: {
  status: "done" | "active" | "failed";
  label: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {status === "done" && <CheckCircle className="text-foreground size-4" />}
      {status === "active" && (
        <CircleNotch className="text-muted-foreground size-4 animate-spin" />
      )}
      {status === "failed" && <XCircle className="text-danger size-4" />}
      <span
        className={
          status === "failed" ? "text-danger" : "text-muted-foreground"
        }
      >
        {label}
      </span>
    </div>
  );
}
