export type Unit = 'g' | 'ml' | 'u' | 'm' | '';

export interface ChainInfo {
  id: string;
  name: string;
}

export interface StoreInfo {
  id: string;
  chainId: string;
  name: string;
  /** Sub-brand inside the chain, e.g. "שופרסל דיל". */
  sub: string;
  city: string;
  address: string;
  /** When the chain published this price list, `YYYY-MM-DDTHH:mm` Israel time. */
  updatedAt: string;
  itemCount: number;
  file: string;
  size: number;
}

export interface DataIndex {
  generatedAt: string;
  chains: ChainInfo[];
  stores: StoreInfo[];
  /** City name → [latitude, longitude], for finding stores near the shopper. */
  geo: Record<string, [number, number]>;
}

/** "Buy `minQty` for a total of `price`". */
export interface Promo {
  minQty: number;
  price: number;
  /** Needs a club / loyalty membership. */
  club: boolean;
  /** Last valid day, YYYY-MM-DD ('' when unknown). */
  end: string;
  desc: string;
  /** Most units the deal applies to per purchase, when the chain limits it. */
  maxQty?: number;
}

/** What one store charges for one product. */
export interface Offer {
  price: number;
  promos: Promo[];
}

/** Row as stored in a store file: code, name, manufacturer, price, qty, unit, weighted, promos. */
export type StoreRow = [
  code: string,
  name: string,
  manufacturer: string,
  price: number,
  qty: number,
  unit: Unit,
  weighted: 0 | 1,
  promos?: Array<[minQty: number, price: number, club: 0 | 1, end: string, desc: string, maxQty?: number]>,
];

export interface StoreData {
  id: string;
  /** Publication time of the price list this was built from. */
  u: string;
  items: StoreRow[];
}

export interface Product {
  /** Barcode for packaged goods; chain-scoped code for in-house items (produce, deli). */
  pid: string;
  code: string;
  name: string;
  manufacturer: string;
  /** Package size in grams / millilitres / units; weighted items are priced per 1000 g. */
  qty: number;
  unit: Unit;
  weighted: boolean;
  /** Search key. */
  norm: string;
  /** Store id → what that store charges. */
  offers: Map<string, Offer>;
}

export interface ListItem {
  id: string;
  label: string;
  /** Units, or kilograms for weighted products. */
  qty: number;
  /** Products that satisfy this line, in order of preference. Empty = not matched yet. */
  pids: string[];
  checked: boolean;
  addedAt: number;
}

export interface Settings {
  /** Count club-member prices when comparing. */
  includeClub: boolean;
  /** Minimum saving, in shekels, that makes shopping in two stores worth suggesting. */
  splitThreshold: number;
  /** How large everything is drawn. */
  textSize: TextSize;
}

export type TextSize = 'normal' | 'large' | 'xl';
