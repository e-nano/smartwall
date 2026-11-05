import { useState } from "react";
import { Image } from "antd";
import { Box } from "lucide-react";
import type { Part } from "../types";

export function ComponentThumbnail({ part, size = 56, preview = true }: { part?: Part; size?: number; preview?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  let images: string[] = [];
  try {
    const parsed: unknown = JSON.parse(part?.images_json || "[]");
    if (Array.isArray(parsed)) images = parsed.filter((image): image is string =>
      typeof image === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image));
  } catch { /* Older components may have no valid attachments. */ }
  const source = images[0];
  return <div className="component-thumbnail" style={{ width: size, height: size }}>
    {source && source !== failedSource ? <Image.PreviewGroup items={images}>
      <Image src={source} alt={part?.name ?? "Component"} width={size} height={size} preview={preview}
        style={{ objectFit: "contain" }} onError={() => setFailedSource(source)} />
    </Image.PreviewGroup> : <Box size={Math.round(size * .42)} aria-label="No component image" />}
  </div>;
}
