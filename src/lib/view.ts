// Derived data and wording shared by several screens.

import { useMemo } from 'react';
import { compareBasket, type Comparison } from '../engine/optimizer';
import { useApp } from '../state/app';
import { todayInIsrael, useData } from '../state/data';
import type { DataIndex, StoreInfo } from '../types';
import type { PricingOptions } from './pricing';

export function usePricingOptions(): PricingOptions {
  const includeClub = useApp((s) => s.settings.includeClub);
  return useMemo(() => ({ includeClub, today: todayInIsrael() }), [includeClub]);
}

/** The chosen stores, in the order they were added. Stores no longer published are dropped. */
export function useChosenStores(): StoreInfo[] {
  const storeIds = useApp((s) => s.storeIds);
  const index = useData((s) => s.index);
  return useMemo(() => {
    const byId = new Map(index?.stores.map((s) => [s.id, s]));
    return storeIds.map((id) => byId.get(id)).filter((s): s is StoreInfo => !!s);
  }, [storeIds, index]);
}

export function useStoreLookup(): (id: string) => StoreInfo | undefined {
  const index = useData((s) => s.index);
  return useMemo(() => {
    const byId = new Map(index?.stores.map((s) => [s.id, s]));
    return (id: string) => byId.get(id);
  }, [index]);
}

export function useComparison(): Comparison {
  const items = useApp((s) => s.items);
  const catalog = useData((s) => s.catalog);
  const opts = usePricingOptions();
  return useMemo(() => compareBasket(items, catalog, catalog.storeIds, opts), [items, catalog, opts]);
}

/** "שופרסל דיל" for a sub-brand, otherwise the chain's name. */
export function chainLabel(store: StoreInfo, index: DataIndex | null): string {
  return store.sub || index?.chains.find((c) => c.id === store.chainId)?.name || '';
}

/** Chain and branch in one line, without repeating the chain when the branch name has it. */
export function storeTitle(store: StoreInfo, index: DataIndex | null): string {
  const chain = index?.chains.find((c) => c.id === store.chainId)?.name ?? '';
  if (!chain || store.name.includes(chain)) return store.name;
  return `${chain} ${store.name}`;
}

export function storePlace(store: StoreInfo): string {
  if (store.address && store.city && !store.address.includes(store.city)) return `${store.address}, ${store.city}`;
  return store.address || store.city;
}

/** How old a price list is, in words a shopper would use. */
export function freshness(updatedAt: string, today = todayInIsrael()): { text: string; stale: boolean } {
  const day = updatedAt.slice(0, 10);
  const time = updatedAt.slice(11, 16);
  if (!day) return { text: 'תאריך עדכון לא ידוע', stale: true };
  const days = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  if (days <= 0) return { text: `מחירים מהיום ${time}`, stale: false };
  if (days === 1) return { text: `מחירים מאתמול ${time}`, stale: false };
  return { text: `מחירים מלפני ${days} ימים`, stale: days > 2 };
}

export const qtyUnit = (weighted: boolean) => (weighted ? 'ק"ג' : undefined);
