import { useQuery } from "@tanstack/react-query";
// @ts-ignore virtual module provided by the Vite changelog plugin
import { latestContent, latestVersion } from "virtual:changelog";

import { processContent } from "@anlg/changelog";

import { loadBundledChangelog } from "./source";

export function useChangelogContent(version: string) {
  const query = useQuery({
    queryKey: ["changelog", version],
    queryFn: async () => {
      if (version === latestVersion && latestContent)
        return latestContent as string;
      return loadBundledChangelog(version);
    },
    staleTime: Infinity,
  });
  const parsed = query.data ? processContent(query.data) : null;
  return {
    content: parsed?.content ?? null,
    date: parsed?.date ?? null,
    loading: query.isPending,
  };
}
