// Shapes the product form edits before handing them to the saveProduct action.

import { IMAGE_PATH } from "./images";

export interface AddonDraft {
  key: string;
  id?: string;
  name: string;
  price: number;
  is_available: boolean;
}

export interface GroupDraft {
  key: string;
  id?: string;
  name: string;
  min_select: number;
  max_select: number;
  addons: AddonDraft[];
}

export interface ProductDraft {
  id?: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  is_visible: boolean;
  is_available: boolean;
  position: number;
  sale_unit: string | null;
  groups: GroupDraft[];
  stock: StockLinkDraft[];
}

/** What one unit sold consumes. addon_key null: the product itself; otherwise the addon's form key. */
export interface StockLinkDraft {
  addon_key: string | null;
  item_id: string;
  quantity: number;
}

/** Optional image: an uploaded photo (/api/images/<id>) or an http(s) address; anything else is dropped. */
export function cleanImageUrl(value: string | null | undefined) {
  const v = (value ?? "").trim();
  if (IMAGE_PATH.test(v)) return v;
  return /^https?:\/\/\S+$/i.test(v) ? v.slice(0, 1000) : null;
}
