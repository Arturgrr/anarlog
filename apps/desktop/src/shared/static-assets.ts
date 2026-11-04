import type { SyntheticEvent } from "react";

export function staticAssetUrl(localPath: string) {
  return localPath;
}

export function fallbackToLocalAsset(localPath: string) {
  return (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.getAttribute("src") !== localPath) image.src = localPath;
  };
}
