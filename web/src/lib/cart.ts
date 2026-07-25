'use client';
import { create } from 'zustand';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { formatMoneyInt } from '@barkath/shared';
import { db } from './firebase';
import { useAuth } from './auth';

export interface CartLine {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  imageUrl: string | null;
  categoryTint: string;
  /**
   * The product's `categorySlug` — what a category-restricted coupon
   * (`applicableCategories`, written by the admin as category *slugs*, which are
   * also the category doc ids) is matched against. Same value the server matches
   * on: PricedLine.category in functions/src/orders/checkout.ts.
   *
   * Nullable because a line can predate this field, and because the Flutter app
   * shares this cart array and does not write it — an unknown category simply
   * never matches a restricted coupon, so it can only under-claim a discount,
   * never over-claim one. `refreshPrices` backfills it from the product doc.
   */
  categorySlug: string | null;
  pricePaise: number;
  mrpPaise: number;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'qty'>, qty?: number) => void;
  setQty: (productId: string, variantId: string | null, qty: number) => void;
  remove: (productId: string, variantId: string | null) => void;
  /** Drop every line for a product — the card's quick-add toggle, untoggled. */
  removeProduct: (productId: string) => void;
  clear: () => void;
  /** Total units across every line — what the bag heading counts. */
  count: () => number;
  /** Distinct products in the bag — what the header badge shows. */
  distinctCount: () => number;
  subtotalPaise: () => number;
  hydrate: () => void;
  /**
   * Re-read live prices *and categories* from products/{id}. Resolves true if
   * anything moved.
   */
  refreshPrices: () => Promise<boolean>;
}

/**
 * Shopping bag, backed by the SAME `customers/{uid}.cart` array the Flutter app
 * writes — so a signed-in user sees one cart on web + app, live and cross-device
 * (real-time via the customer-doc snapshot). Guests fall back to localStorage;
 * their local cart is merged into their account the first time they sign in.
 *
 * The public API (add/setQty/remove/clear/lines/count/subtotalPaise/hydrate) is
 * unchanged — callers don't need to know whether they're a guest or signed in.
 */

const KEY = 'barakath.cart';

// ── Cart / order limits ─────────────────────────────────────────────────────
// The SAME four numbers the server enforces (a functions-lane agent is making
// placeOrder/reserveStock authoritative on them). These are the client mirror:
// they exist to explain the refusal before the customer has typed a card
// number, never to be the only guard. `MAX_CART_LINES` replaces the old
// unnamed, unexported `MAX_LINES = 50` that already silently truncated the
// stored cart — same value, one definition.

/** Distinct product+variant lines a bag may hold. */
export const MAX_CART_LINES = 50;
/** Units of any single line. The live per-line stock cap still applies — whichever is lower wins. */
export const MAX_QTY_PER_LINE = 10;
/** Units across the whole order. */
export const MAX_UNITS_PER_ORDER = 100;
/** ₹2,00,000. */
export const MAX_ORDER_TOTAL_PAISE = 20_000_000;

const sameLine = (a: CartLine, productId: string, variantId: string | null) =>
  a.productId === productId && a.variantId === variantId;

/** Total units across a set of lines. */
const unitsIn = (lines: CartLine[]): number => lines.reduce((n, l) => n + l.qty, 0);

/**
 * Why `qty` more units of this line cannot go in the bag, or null when they
 * can. The message is what the caller passes to the existing toast — there is
 * no new UI for any of this.
 *
 * Stock is deliberately NOT checked here: each surface already caps against
 * live availability (and says which line is short), and the lower of the two
 * caps wins naturally because both are applied.
 */
export function addToCartError(
  lines: CartLine[],
  productId: string,
  variantId: string | null,
  qty: number,
): string | null {
  const existing = lines.find((l) => sameLine(l, productId, variantId));
  if (!existing && lines.length >= MAX_CART_LINES) {
    return `Your bag holds ${MAX_CART_LINES} different items — remove one to add another.`;
  }
  if ((existing?.qty ?? 0) + qty > MAX_QTY_PER_LINE) {
    return `You can buy up to ${MAX_QTY_PER_LINE} of an item in one order.`;
  }
  if (unitsIn(lines) + qty > MAX_UNITS_PER_ORDER) {
    return `An order can hold up to ${MAX_UNITS_PER_ORDER} items in total.`;
  }
  return null;
}

/** Why the bag's stepper cannot take this line to `qty`, or null when it can. */
export function setQtyError(
  lines: CartLine[],
  productId: string,
  variantId: string | null,
  qty: number,
): string | null {
  const current = lines.find((l) => sameLine(l, productId, variantId))?.qty ?? 0;
  if (qty <= current) return null; // going down is always allowed
  return addToCartError(lines, productId, variantId, qty - current);
}

/**
 * Why this bag cannot be ordered as it stands, or null when it can.
 *
 * Checked at checkout as well as at every add, because a bag is shared live
 * with the Flutter app and other tabs and can arrive here already over a cap.
 */
export function orderLimitError(lines: CartLine[], totalPaise: number): string | null {
  if (lines.length > MAX_CART_LINES) {
    return `An order can include up to ${MAX_CART_LINES} different items. Please remove a few.`;
  }
  if (lines.some((l) => l.qty > MAX_QTY_PER_LINE)) {
    return `You can buy up to ${MAX_QTY_PER_LINE} of an item in one order. Please reduce the quantity.`;
  }
  if (unitsIn(lines) > MAX_UNITS_PER_ORDER) {
    return `An order can hold up to ${MAX_UNITS_PER_ORDER} items in total. Please remove a few.`;
  }
  if (totalPaise > MAX_ORDER_TOTAL_PAISE) {
    return `Orders are limited to ${formatMoneyInt(MAX_ORDER_TOTAL_PAISE)}. Please split this into smaller orders.`;
  }
  return null;
}

/**
 * Lines read back from storage (localStorage or the customer doc) were written
 * before `categorySlug` existed — or by the app, which drops keys it doesn't
 * know — so the field is simply absent on them. Materialise it as an explicit
 * null so every consumer can read `line.categorySlug` without a runtime hole,
 * and so it survives the next write instead of being dropped again.
 */
const withCategory = (lines: CartLine[]): CartLine[] =>
  // Returned untouched when every line already has the key, so a snapshot that
  // changed nothing keeps its identity and doesn't re-render the bag/checkout.
  lines.every((l) => 'categorySlug' in l)
    ? lines
    : lines.map((l) => ({ ...l, categorySlug: l.categorySlug ?? null }));

// ── localStorage (guest) ──
function readLocal(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? withCategory(JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}
function persistLocal(lines: CartLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* ignore */
  }
}
function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const currentUid = (): string | null => useAuth.getState().user?.uid ?? null;

// ── pure reducers (shared by local + remote paths) ──
// The reducers clamp to the limits as a LAST resort — every surface checks
// first and explains itself (addToCartError / setQtyError), so a clamp here
// should never be what a customer meets. It exists because this cart is also
// merged from localStorage and from the Flutter app's copy, neither of which
// went through those checks.
function addTo(lines: CartLine[], line: Omit<CartLine, 'qty'>, qty: number): CartLine[] {
  const out = [...lines];
  const i = out.findIndex((l) => sameLine(l, line.productId, line.variantId));
  if (i >= 0) out[i] = { ...out[i]!, qty: Math.min(out[i]!.qty + qty, MAX_QTY_PER_LINE) };
  else if (out.length < MAX_CART_LINES) out.push({ ...line, qty: Math.min(qty, MAX_QTY_PER_LINE) });
  return out;
}
const setQtyIn = (lines: CartLine[], productId: string, variantId: string | null, qty: number): CartLine[] =>
  lines
    .map((l) => (sameLine(l, productId, variantId) ? { ...l, qty: Math.min(qty, MAX_QTY_PER_LINE) } : l))
    .filter((l) => l.qty > 0);
const removeIn = (lines: CartLine[], productId: string, variantId: string | null): CartLine[] =>
  lines.filter((l) => !sameLine(l, productId, variantId));
function mergeLines(base: CartLine[], extra: CartLine[]): CartLine[] {
  let out = [...base];
  for (const e of extra) out = addTo(out, e, e.qty);
  return out;
}

/** `productId:variantId` — key for the live-price lookup below. */
const lineKey = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ''}`;

/**
 * Live price for a line, read the way `priceLines` in
 * functions/src/orders/checkout.ts prices it: the variant's numbers when the
 * line names one, else the product's. Falls back to the MRP when no offer
 * price is stored so a line can never be repriced to zero.
 */
function livePrice(
  p: Record<string, unknown>,
  variantId: string | null,
  fallback: { pricePaise: number; mrpPaise: number },
): { pricePaise: number; mrpPaise: number } | null {
  let mrpPaise = Number(p.mrpPaise ?? fallback.mrpPaise);
  let offerPaise = Number(p.offerPricePaise ?? mrpPaise);
  if (variantId) {
    const v = ((p.variants as Array<Record<string, unknown>> | undefined) ?? []).find(
      (x) => x.id === variantId,
    );
    // Variant gone — leave the line untouched; placeOrder reports it properly.
    if (!v) return null;
    mrpPaise = Number(v.mrpPaise ?? mrpPaise);
    offerPaise = Number(v.offerPricePaise ?? offerPaise);
  }
  const pricePaise = offerPaise > 0 ? offerPaise : mrpPaise;
  if (!Number.isFinite(pricePaise) || pricePaise <= 0 || !Number.isFinite(mrpPaise)) return null;
  return { pricePaise, mrpPaise: Math.max(mrpPaise, 0) };
}

/**
 * How many cart writes are in flight, and a promise chain that SERIALISES them.
 *
 * Both matter for a fast add→remove:
 *  - Serialising means the remove's transaction runs strictly AFTER the add's,
 *    so the final stored cart is what the customer last did — not whichever of
 *    two concurrent transactions happened to commit last (which could re-add an
 *    item the customer just removed).
 *  - The in-flight count lets the Firestore→store bridge below IGNORE the
 *    customer-doc echoes these writes produce. Without that, each intermediate
 *    write bounces back through the snapshot and overwrites the optimistic local
 *    cart, so the button visibly flip-flops add/remove on its own until the dust
 *    settles.
 */
let cartWritesInFlight = 0;
let cartWriteChain: Promise<void> = Promise.resolve();
export function cartWriteInFlight(): boolean {
  return cartWritesInFlight > 0;
}

/** Transactionally apply `mutate` to `customers/{uid}.cart` (owner-writable). */
function writeRemote(uid: string, mutate: (cur: CartLine[]) => CartLine[]): Promise<void> {
  cartWritesInFlight++;
  const run = cartWriteChain.then(async () => {
    const ref = doc(db, 'customers', uid);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = withCategory((snap.data()?.cart as CartLine[] | undefined) ?? []);
        const next = mutate(cur).filter((l) => l.qty > 0).slice(0, MAX_CART_LINES);
        tx.update(ref, { cart: next, updatedAt: serverTimestamp() });
      });
    } catch {
      /* offline / transient — the optimistic UI stays until the next snapshot */
    }
  });
  // Keep the chain alive even if a link rejects, and decrement once settled.
  cartWriteChain = run.catch(() => undefined);
  void run.finally(() => {
    cartWritesInFlight--;
  });
  return run;
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  add: (line, qty = 1) => {
    const uid = currentUid();
    const next = addTo(get().lines, line, qty);
    set({ lines: next }); // optimistic
    if (uid) void writeRemote(uid, (cur) => addTo(cur, line, qty));
    else persistLocal(next);
  },
  setQty: (productId, variantId, qty) => {
    const uid = currentUid();
    const next = setQtyIn(get().lines, productId, variantId, qty);
    set({ lines: next });
    if (uid) void writeRemote(uid, (cur) => setQtyIn(cur, productId, variantId, qty));
    else persistLocal(next);
  },
  remove: (productId, variantId) => {
    const uid = currentUid();
    const next = removeIn(get().lines, productId, variantId);
    set({ lines: next });
    if (uid) void writeRemote(uid, (cur) => removeIn(cur, productId, variantId));
    else persistLocal(next);
  },
  removeProduct: (productId) => {
    const uid = currentUid();
    // Every variant of the product, not one line: the card's quick-add toggle
    // reports "in bag" for the product as a whole, so untoggling it has to
    // clear the whole product or the ✓ would stay lit with no way to undo it.
    const drop = (ls: CartLine[]) => ls.filter((l) => l.productId !== productId);
    const next = drop(get().lines);
    set({ lines: next });
    if (uid) void writeRemote(uid, drop);
    else persistLocal(next);
  },
  clear: () => {
    const uid = currentUid();
    set({ lines: [] });
    if (uid) void writeRemote(uid, () => []);
    else clearLocal();
  },
  count: () => get().lines.reduce((n, l) => n + l.qty, 0),
  distinctCount: () => get().lines.length,
  subtotalPaise: () => get().lines.reduce((n, l) => n + l.pricePaise * l.qty, 0),
  hydrate: () => {
    // Guests load their local cart; signed-in carts arrive via the auth bridge.
    if (!currentUid()) set({ lines: readLocal() });
  },
  refreshPrices: async () => {
    // Lines snapshot the price at "Add to bag" and can sit in the cart for
    // days, but placeOrder always prices from the product doc — so without
    // this the bag/checkout totals (and the Place order button) can be lower
    // or higher than what is actually charged.
    const lines = get().lines;
    if (lines.length === 0) return false;
    const ids = [...new Set(lines.map((l) => l.productId))];
    const snaps = await Promise.all(
      ids.map((id) =>
        getDoc(doc(db, 'products', id)).catch(() => null),
      ),
    );
    const byId = new Map<string, Record<string, unknown>>();
    snaps.forEach((s, i) => {
      if (s?.exists()) byId.set(ids[i]!, s.data() as Record<string, unknown>);
    });
    if (byId.size === 0) return false;

    const priced = new Map<string, { pricePaise: number; mrpPaise: number; categorySlug: string | null }>();
    let changed = false;
    for (const l of lines) {
      const p = byId.get(l.productId);
      if (!p) continue;
      const live = livePrice(p, l.variantId, l);
      if (!live) continue;
      // The coupon engine matches a line's category against a coupon's
      // applicableCategories, and placeOrder reads that slug off the LIVE
      // product doc — so take it from the same place. This is also what fills
      // it in for lines that never had one (older carts, and carts written by
      // the app), which would otherwise match no restricted coupon at all.
      const categorySlug = (p.categorySlug as string | undefined) || null;
      if (
        live.pricePaise === l.pricePaise &&
        live.mrpPaise === l.mrpPaise &&
        categorySlug === (l.categorySlug ?? null)
      ) {
        continue;
      }
      priced.set(lineKey(l.productId, l.variantId), { ...live, categorySlug });
      changed = true;
    }
    if (!changed) return false;

    const applyPrices = (cur: CartLine[]): CartLine[] =>
      cur.map((l) => {
        const next = priced.get(lineKey(l.productId, l.variantId));
        return next ? { ...l, ...next } : l;
      });

    const uid = currentUid();
    const next = applyPrices(get().lines);
    set({ lines: next });
    if (uid) void writeRemote(uid, applyPrices);
    else persistLocal(next);
    return true;
  },
}));

// ── Bridge: mirror the signed-in customer's Firestore cart into the store in
// real time, and migrate a guest's local cart into their account on sign-in. ──
let bridgedUid: string | null = null;
useAuth.subscribe((state) => {
  const uid = state.user?.uid ?? null;
  if (!uid) {
    bridgedUid = null;
    useCart.setState({ lines: readLocal() });
    return;
  }
  const remote = withCategory((state.customer?.cart as unknown as CartLine[] | undefined) ?? []);
  if (uid !== bridgedUid) {
    bridgedUid = uid;
    const local = readLocal();
    if (local.length) {
      clearLocal();
      void writeRemote(uid, (cur) => mergeLines(cur, local));
      useCart.setState({ lines: mergeLines(remote, local) }); // optimistic merge
      return;
    }
  } else if (cartWriteInFlight()) {
    // One of OUR writes is still settling — this snapshot is its own echo (or an
    // intermediate state of a rapid add→remove). Adopting it would clobber the
    // optimistic local cart and make the toggle flicker. The last write's own
    // echo will arrive when the queue drains and reconcile us then; a genuine
    // cross-device change simply applies on the next idle snapshot.
    return;
  }
  useCart.setState({ lines: remote });
});
