import {
  canvasMeasure,
  type Ctx,
  drawScene,
  makeCanvas,
  type Source,
} from "./draw";
import { exportRect, marksInRect } from "./geometry";
import { type Doc } from "./model";

export async function flatten(doc: Doc, image: Source): Promise<Blob> {
  const rect = exportRect(doc);
  const canvas = makeCanvas(rect.width, rect.height);
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("Canvas is not available");
  ctx.translate(-rect.x, -rect.y);
  drawScene(
    ctx,
    { ...doc, marks: marksInRect(doc, rect, canvasMeasure) },
    image,
  );
  if ("convertToBlob" in canvas)
    return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode PNG")),
      "image/png",
    );
  });
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  return image;
}

export function imageFromBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}
