import { z } from "zod";

export const MAX_IMAGE_BYTES = 512 * 1024;
// Store portable image bytes, not arbitrary URLs that a server would have to fetch.
// SVG/HTML are deliberately excluded from component attachments.
export const componentImagesSchema = z.array(z.string().max(710000)).max(4).superRefine((images, ctx) => {
  let total = 0;
  for (const image of images) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) { ctx.addIssue({ code: "custom", message: "Use PNG, JPEG or WebP image attachments" }); continue; }
    const bytes = Buffer.from(match[2], "base64");
    total += bytes.length;
    const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP";
    if (!valid || bytes.toString("base64") !== match[2]) ctx.addIssue({ code: "custom", message: "Invalid image attachment" });
  }
  if (total > MAX_IMAGE_BYTES) ctx.addIssue({ code: "custom", message: "Component images must total 512 KiB or less" });
});

export const sourceUrlSchema = z.union([z.literal(""), z.string().url().max(2000).refine(value => {
  const url=new URL(value); return url.protocol === "https:" && !url.username && !url.password;
}, "Source URL must use HTTPS without embedded credentials")]).default("");

export const categoryPathSchema = z.array(z.string().trim().min(1).max(100)).min(1);

export const componentSchema = z.object({
  partId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).default(""),
  category: z.string().trim().min(1).max(100).default("Other"),
  subcategory: z.string().trim().min(1).max(100).default("Other"),
  categoryPath: categoryPathSchema.optional(),
  headType: z.string().trim().min(1).max(100).default("Not applicable"),
  measurementSystem: z.enum(["Metric", "Imperial", "Not applicable"]).default("Not applicable"),
  nominalDiameter: z.string().trim().min(1).max(40).default("Not applicable"),
  nominalLength: z.string().trim().min(1).max(40).default("Not applicable"),
  accuProductCode: z.string().trim().max(100).default(""),
  accuOrderQuantity: z.number().int().nonnegative().default(0),
  reorderLevel: z.number().int().nonnegative().default(0),
  unitWeightGrams: z.number().positive().optional(),
  images: componentImagesSchema.default([]),
  sourceSupplier: z.string().trim().max(100).default(""),
  sourceProductCode: z.string().trim().max(100).default(""),
  sourceUrl: sourceUrlSchema
}).strict().transform(component => {
  const categoryPath=component.categoryPath ?? [component.category,component.subcategory];
  return { ...component,categoryPath,category:categoryPath[0],subcategory:categoryPath[1] ?? "Other" };
});
