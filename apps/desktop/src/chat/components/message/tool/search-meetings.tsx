import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";

import { MagnifyingGlass } from "@anlg/ui/components/icons";
import { Card, CardContent } from "@anlg/ui/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@anlg/ui/components/ui/carousel";

import { useToolState } from "./shared";

import { Disclosure } from "~/chat/components/message/shared";
import { ToolRenderer } from "~/chat/components/message/types";
import { useTabs } from "~/store/zustand/tabs";

type Renderer = ToolRenderer<"tool-search_meetings">;
type Part = Parameters<Renderer>[0]["part"];
type MeetingSearchResult = {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  created_at: number | string;
};

function parseMeetingSearchResults(output: unknown): MeetingSearchResult[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const record = output as { results?: unknown; meetings?: unknown };
  const results = Array.isArray(record.results)
    ? record.results
    : Array.isArray(record.meetings)
      ? record.meetings
      : null;
  if (!results) {
    return [];
  }

  return results.flatMap((result): MeetingSearchResult[] => {
    if (!result || typeof result !== "object") {
      return [];
    }

    const { id, title, excerpt, score, created_at, started_at } = result as {
      id?: unknown;
      title?: unknown;
      excerpt?: unknown;
      score?: unknown;
      created_at?: unknown;
      started_at?: unknown;
    };
    if (typeof id !== "string") {
      return [];
    }

    return [
      {
        id,
        title: typeof title === "string" ? title : "",
        excerpt: typeof excerpt === "string" ? excerpt : "",
        score: typeof score === "number" ? score : 0,
        created_at:
          typeof started_at === "string" && started_at
            ? started_at
            : typeof created_at === "number" || typeof created_at === "string"
              ? created_at
              : 0,
      },
    ];
  });
}

function formatSearchInput(
  input: Part["input"] | undefined,
  locale: string,
): {
  titleQuery: string;
  details: string[];
} {
  if (!input) {
    return { titleQuery: t`meetings`, details: [] };
  }

  const details: string[] = [];
  const rawQuery = typeof input.query === "string" ? input.query.trim() : "";
  const titleQuery = rawQuery || t`meetings`;

  if (!rawQuery) {
    details.push(t`Query: none`);
  } else {
    details.push(t`Query: ${rawQuery}`);
  }

  const createdAt = input.filters?.created_at;
  if (createdAt?.kind === "relative") {
    details.push(
      plural(createdAt.recent_days ?? 0, {
        one: "Date: recent # day, including today",
        other: "Date: recent # days, including today",
      }),
    );
  } else if (createdAt?.kind === "absolute") {
    const bounds = [
      createdAt.gte != null
        ? `gte ${new Date(createdAt.gte).toLocaleString(locale)}`
        : null,
      createdAt.lte != null
        ? `lte ${new Date(createdAt.lte).toLocaleString(locale)}`
        : null,
      createdAt.gt != null
        ? `gt ${new Date(createdAt.gt).toLocaleString(locale)}`
        : null,
      createdAt.lt != null
        ? `lt ${new Date(createdAt.lt).toLocaleString(locale)}`
        : null,
      createdAt.eq != null
        ? `eq ${new Date(createdAt.eq).toLocaleString(locale)}`
        : null,
    ].filter(Boolean);

    if (bounds.length > 0) {
      const dateBounds = bounds.join(", ");
      details.push(t`Date: ${dateBounds}`);
    }
  }

  if (typeof input.limit === "number") {
    const limit = input.limit;
    details.push(t`Limit: ${limit}`);
  }

  return { titleQuery, details };
}

export const ToolSearchMeetings: Renderer = ({ part }) => {
  const { i18n } = useLingui();
  const { running: disabled } = useToolState(part);

  return (
    <Disclosure
      icon={<MagnifyingGlass className="h-3 w-3" />}
      title={getTitle(part, i18n.locale)}
      disabled={disabled}
    >
      <RenderContent part={part} />
    </Disclosure>
  );
};

const getTitle = (part: Part, locale: string) => {
  const { titleQuery } = formatSearchInput(part.input, locale);

  if (part.state === "input-streaming") {
    return t`Preparing search...`;
  }
  if (part.state === "input-available") {
    return t`Searching for: ${titleQuery}`;
  }
  if (part.state === "output-available") {
    return t`Searched for: ${titleQuery}`;
  }
  if (part.state === "output-error") {
    return part.input ? t`Search failed: ${titleQuery}` : t`Search failed`;
  }
  return t`Search`;
};

function RenderContent({ part }: { part: Part }) {
  const { i18n } = useLingui();
  const { details } = formatSearchInput(part.input, i18n.locale);

  if (part.state === "output-available") {
    const results = parseMeetingSearchResults(part.output);

    if (!results || results.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          {details.length > 0 && (
            <div className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
              {details.map((detail) => (
                <div key={detail}>{detail}</div>
              ))}
            </div>
          )}
          <div className="text-muted-foreground flex items-center justify-center py-2 text-xs">
            <Trans>No results found</Trans>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {details.length > 0 && (
          <div className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
            {details.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        )}
        <div className="relative -mx-1">
          <Carousel className="w-full" opts={{ align: "start" }}>
            <CarouselContent className="-ml-2">
              {results.map((result, index: number) => (
                <CarouselItem
                  key={result.id || index}
                  className="basis-full pl-1 sm:basis-1/2 lg:basis-1/3"
                >
                  <Card className="bg-muted h-full">
                    <CardContent className="px-2 py-0.5">
                      <RenderMeeting result={result} />
                    </CardContent>
                  </Card>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="bg-muted hover:bg-accent -left-4 h-6 w-6" />
            <CarouselNext className="bg-muted hover:bg-accent -right-4 h-6 w-6" />
          </Carousel>
        </div>
      </div>
    );
  }

  if (part.state === "output-error") {
    const errorText = part.errorText;
    return (
      <div className="text-danger text-sm">
        <Trans>Error: {errorText}</Trans>
      </div>
    );
  }

  return details.length > 0 ? (
    <div className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
      {details.map((detail) => (
        <div key={detail}>{detail}</div>
      ))}
    </div>
  ) : null;
}

function RenderMeeting({ result }: { result: MeetingSearchResult }) {
  const { i18n, t } = useLingui();
  const { id: sessionId } = result;
  const openNew = useTabs((state) => state.openNew);

  const handleClick = useCallback(() => {
    openNew({ type: "sessions", id: sessionId });
  }, [openNew, sessionId]);

  const dateLabel = useMemo(() => {
    if (!result.created_at) return null;
    return new Date(result.created_at).toLocaleString(i18n.locale);
  }, [result.created_at, i18n.locale]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full flex-col gap-1 text-left text-xs"
    >
      <span className="truncate font-medium">
        {result.title || t`Untitled`}
      </span>
      {dateLabel && (
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {dateLabel}
        </span>
      )}
      <span className="text-muted-foreground line-clamp-3 break-words">
        {result.excerpt || t`No excerpt available`}
      </span>
    </button>
  );
}
