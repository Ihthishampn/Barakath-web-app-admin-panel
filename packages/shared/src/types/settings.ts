import type { Ts } from './common.js';

// ── settings/variables (tech-arch §1.1) ────────────────────────────
export interface VariableUnit {
  id: string;
  name: string;
  code: string; // SKU builder code, e.g. GR, M
  order: number;
}
export interface ColorUnit extends VariableUnit {
  hex: string; // admin-picked swatch (design-token exception §1.0)
}
export interface DirectUnitsVariable {
  id: string;
  name: string;
  order: number;
  units: ColorUnit[];
}
export interface GroupVariable {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  units: VariableUnit[];
}
export interface SettingsVariables {
  id: 'variables';
  directUnits: DirectUnitsVariable[];
  groups: GroupVariable[];
  updatedAt: Ts;
}

// ── Other settings singletons ──────────────────────────────────────
export interface SettingsDelivery {
  id: 'delivery';
  freeDeliveryOverPaise: number;
  standardFeePaise: number;
  codSurchargePaise: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  updatedAt: Ts;
}

export interface SettingsPaymentGateway {
  id: 'paymentGateway';
  razorpayKeyId: string;
  codEnabled: boolean;
  codMaxAmountPaise: number;
  walletEnabled: boolean;
  onlinePaymentEnabled: boolean;
  updatedAt: Ts;
}

export interface SettingsTax {
  id: 'tax';
  gstRate: number; // 0.18
  gstEnabled: boolean;
  gstin: string;
  legalName: string;
  businessCity: string;
  businessCountry: string;
  pricesIncludeTax: boolean;
  hsnCodes: Record<string, string>;
  updatedAt: Ts;
}

export interface SettingsAffiliate {
  id: 'affiliate';
  enabled: boolean;
  // No global default commission rate — commission lives on each product now
  // (amount or percentage). New products prefill from DEFAULT_PRODUCT_COMMISSION_RATE.
  commissionClearanceDays: number;
  minWithdrawalPaise: number;
  maxWithdrawalPerDayPaise: number;
  processingFeeType: 'fixed' | 'percent';
  processingFeeValue: number;
  processingFeeMinPaise: number;
  shareMessage: string;
  updatedAt: Ts;
}

export interface SettingsReturns {
  id: 'returns';
  windowDays: number;
  autoRefundToWallet: boolean;
  updatedAt: Ts;
}

export interface SettingsSupport {
  id: 'support';
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  supportEnabled: boolean;
  updatedAt: Ts;
}

/** Quick-search chips shown on the storefront's empty search screen. */
export interface SettingsSearchSuggestions {
  id: 'searchSuggestions';
  terms: string[];
  updatedAt: Ts;
}

/** One entry in the storefront announcement carousel. */
export interface AnnouncementItem {
  id: string;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
}

export interface SettingsAnnouncement {
  id: 'announcement';
  /** Master on/off for the whole strip. */
  active: boolean;
  /** Carousel entries — rotated on the storefront when there's more than one. */
  items: AnnouncementItem[];
  /** Legacy single-message fields, kept so older docs/readers still work. */
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  startsAt: Ts | null;
  endsAt: Ts | null;
  updatedAt: Ts;
}

// ── content/* pages ────────────────────────────────────────────────
/**
 * An admin-authored content page (privacy, terms, return policy, or anything
 * the admin creates). The storefront discovers these dynamically — it renders a
 * chip per published page — so adding a policy needs no code change.
 */
/**
 * One block within a content page — a heading plus its text. A page is a list
 * of these, so an admin can add as many sections as a policy needs.
 */
export interface ContentSection {
  id: string;
  heading: string;
  /** Markdown, rendered by the storefront's safe text-only formatter. */
  body: string;
  order: number;
}

export interface ContentPage {
  id: string;
  title: string;
  /** URL segment used by /account/legal/{slug}. Unique across pages. */
  slug: string;
  /** The page's content, in display order. */
  sections: ContentSection[];
  /**
   * Legacy single-blob body, kept so pages authored before sections still
   * render. New writes populate `sections`; readers fall back to this when
   * `sections` is empty.
   */
  body: string;
  bodyHtml: string;
  /** Chip order in both the admin rail and the storefront. */
  order: number;
  /** Unpublished pages are hidden from the storefront but kept in the admin. */
  published: boolean;
  /** Built-in pages (privacy, terms, returns) — renameable but not deletable. */
  system: boolean;
  version: number;
  lastEditorUid: string;
  publishedAt: Ts;
  updatedAt: Ts;
}

/** Pages seeded on first run; `system` so they can't be deleted by accident. */
export const DEFAULT_CONTENT_PAGES: { id: string; title: string; slug: string; order: number }[] = [
  { id: 'privacyPolicy', title: 'Privacy policy', slug: 'privacy-policy', order: 10 },
  { id: 'termsConditions', title: 'Terms & conditions', slug: 'terms-conditions', order: 20 },
  { id: 'returnsPolicy', title: 'Return policy', slug: 'return-policy', order: 30 },
];

// ── pincodes ───────────────────────────────────────────────────────
export interface Pincode {
  id: string;
  city: string;
  district: string;
  state: string;
  codAvailable: boolean;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  serviceable: boolean;
  updatedAt: Ts;
}
