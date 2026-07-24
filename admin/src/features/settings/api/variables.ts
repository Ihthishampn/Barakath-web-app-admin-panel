import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type {
  ColorUnit,
  DirectUnitsVariable,
  GroupVariable,
  SettingsVariables,
  VariableUnit,
} from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useLiveDoc } from '@/hooks/firestoreCache';

/** settings/variables — Color direct-units + Size/Material groups. */
export function useVariables() {
  return useLiveDoc<SettingsVariables>('settings/variables');
}

/** Stable id from a label, e.g. "Rose Gold" → "rose-gold". */
export function unitId(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** SKU-builder code auto-derived from a name: first two alnum chars, upper. */
export function unitCode(name: string): string {
  const alnum = name.replace(/[^a-zA-Z0-9]/g, '');
  return (alnum.slice(0, 2) || alnum.slice(0, 1) || 'X').toUpperCase();
}

/**
 * Persist the full variables singleton (setDoc merge). Callers pass the next
 * directUnits / groups arrays; updatedAt is stamped server-side.
 */
export async function saveVariables(next: {
  directUnits: DirectUnitsVariable[];
  groups: GroupVariable[];
}): Promise<void> {
  await setDoc(
    doc(db, 'settings', 'variables'),
    {
      id: 'variables',
      directUnits: next.directUnits,
      groups: next.groups,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function makeColorUnit(name: string, hex: string, order: number): ColorUnit {
  return { id: unitId(name), name: name.trim(), code: unitCode(name), order, hex };
}

export function makeGroupUnit(name: string, order: number): VariableUnit {
  return { id: unitId(name), name: name.trim(), code: unitCode(name), order };
}

/**
 * Usage counts for EVERY unit id, from one pass over `products`.
 *
 * Callers check units one at a time (a group delete walks all of its units, the
 * units modal re-checks on each chip removal), and the old per-unit scan
 * downloaded the whole collection again for each check — N full-collection reads
 * to delete a group of N units. One scan answers them all.
 *
 * Cached for a few seconds with single-flight de-duplication so a burst of
 * checks costs a single read. The TTL is deliberately short: this is a
 * delete-safety check, and a check can never be perfectly current anyway (a
 * variant can be added the instant after any read), so bounded staleness is the
 * same class of race the un-cached version already had.
 */
const UNIT_USAGE_TTL_MS = 15_000;
let unitUsage: { at: number; counts: Map<string, number> } | null = null;
let unitUsageInFlight: Promise<Map<string, number>> | null = null;

async function scanUnitUsage(): Promise<Map<string, number>> {
  const snap = await getDocs(collection(db, 'products'));
  const counts = new Map<string, number>();
  for (const d of snap.docs) {
    const variants = (d.data().variants ?? []) as { attributes?: Record<string, string> }[];
    // Per PRODUCT, not per variant: a unit used by three variants of the same
    // product still counts as one product (matches the previous behaviour).
    const used = new Set<string>();
    for (const v of variants) {
      if (!v.attributes) continue;
      for (const value of Object.values(v.attributes)) used.add(value);
    }
    for (const id of used) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  unitUsage = { at: Date.now(), counts };
  return counts;
}

function loadUnitUsage(): Promise<Map<string, number>> {
  if (unitUsage && Date.now() - unitUsage.at < UNIT_USAGE_TTL_MS) {
    return Promise.resolve(unitUsage.counts);
  }
  unitUsageInFlight ??= scanUnitUsage().finally(() => {
    unitUsageInFlight = null;
  });
  return unitUsageInFlight;
}

/**
 * Delete-safety: how many products reference a unit id (via variant.attributes
 * map values). Scans products client-side — attributes is a free-form map so it
 * can't be server-queried without a composite index.
 */
export async function countProductsUsingUnit(unitIdValue: string): Promise<number> {
  const counts = await loadUnitUsage();
  return counts.get(unitIdValue) ?? 0;
}
