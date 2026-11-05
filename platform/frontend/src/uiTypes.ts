import type { UploadFile } from "antd";

export type ViewKey = "goods-in" | "overview" | "analysis" | "bins" | "catalog" | "orders" | "updates" | "help";
export type StockAction = "find" | "pick" | "restock";

export type PartFormValues = {
  partId: string;
  name: string;
  description?: string;
  images?: string[]; sourceSupplier?: string; sourceProductCode?: string; sourceUrl?: string;
  categoryPath?: string[]; nestedTypes?: string[];
  category: string;
  subcategory: string;
  headType: string;
  measurementSystem: string;
  nominalDiameter: string;
  nominalLength: string;
  accuProductCode: string;
  accuOrderQuantity: number;
  reorderLevel: number;
};

export type FirmwareFormValues = {
  manifest: UploadFile[];
  firmware: UploadFile[];
};

export type Movement = {
  key: string;
  name: string;
  restocked: number;
  picked: number;
};
