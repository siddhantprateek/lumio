import * as fabric from "fabric";

/**
 * Cuts the subject out of an image, in the browser, with the same library
 * text-behind-image uses. The segmentation model (~44 MB, quantised) downloads
 * on first use and is then served from the browser cache.
 * Resolves to a saved upload URL of the transparent PNG.
 *
 * `onProgress` gets 0–1 while the model downloads.
 */
export async function cutOutSubject(
  image: fabric.FabricImage,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const { removeBackground } = await import("@imgly/background-removal");
  const run = () =>
    removeBackground(image.getSrc(), {
      model: "isnet_quint8",
      output: { format: "image/png" },
      progress: (key, current, total) => {
        if (key.startsWith("fetch:") && total > 0) onProgress?.(current / total);
      },
    });
  // A dropped chunk during the model download surfaces as a TypeError; try once more.
  const blob = await run().catch((error) => {
    if (error instanceof TypeError) return run();
    throw error;
  });
  const form = new FormData();
  form.append("file", new File([blob], "cutout.png", { type: "image/png" }));
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok || !data.url) throw new Error(data.error || "Could not save the cutout.");
  return data.url;
}
