import { z } from "zod";
export const MAX_IMAGE_BYTES: number;
export const componentImagesSchema: z.ZodType<string[]>;
export const sourceUrlSchema: z.ZodType<string>;
export const categoryPathSchema: z.ZodType<string[]>;
export type ComponentInput = {
  partId: string; name: string; description: string; category: string; subcategory: string; categoryPath: string[];
  headType: string; measurementSystem: "Metric" | "Imperial" | "Not applicable";
  nominalDiameter: string; nominalLength: string; accuProductCode: string;
  accuOrderQuantity: number; reorderLevel: number; images: string[]; unitWeightGrams?: number;
  sourceSupplier: string; sourceProductCode: string; sourceUrl: string;
};
export const componentSchema: z.ZodType<ComponentInput>;
