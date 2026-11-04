import * as fabric from "fabric";

/**
 * Cuts the subject out of an image, in the browser (a small segmentation model,
 * downloaded on first use). Resolves to a saved upload URL of the transparent PNG.
 */
export async function cutOutSubject(image: fabric.FabricImage): Promise<string> {
  const { removeBackground } = await import("@imgly/background-removal");
  const blob = await removeBackground(image.getSrc(), { output: { format: "image/png" } });
  const form = new FormData();
  form.append("file", new File([blob], "cutout.png", { type: "image/png" }));
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok || !data.url) throw new Error(data.error || "Could not save the cutout.");
  return data.url;
}
