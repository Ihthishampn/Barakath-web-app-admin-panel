import {
  RiDashboardLine,
  RiShoppingBag3Line,
  RiGridLine,
  RiMenuLine,
  RiShoppingBagLine,
  RiUserLine,
  RiWalletLine,
  RiArrowLeftLine,
  RiGiftLine,
  RiBookmarkLine,
  RiUserHeartLine,
  RiEyeLine,
  RiStarLine,
  RiNotificationLine,
  RiSettingsLine,
  RiFileList3Line,
  RiFlashlightLine,
  type RemixiconComponentType,
} from '@remixicon/react';
import type { ModuleKey } from '@barkath/shared';

export interface NavItem {
  label: string;
  path: string;
  icon: RemixiconComponentType;
  module: ModuleKey;
  /**
   * Restricted to super admins regardless of `module`, matching a firestore
   * rule that reads `isSuperAdmin()` rather than `canView(...)`. The sidebar
   * hides it and RequireModule refuses the route; a module key is still
   * required so breadcrumbs and the route guard have something to key on.
   */
  superAdminOnly?: boolean;
}
export interface NavGroup {
  /** null = standalone item above the first group heading (Dashboard). */
  heading: string | null;
  items: NavItem[];
}

/**
 * Sidebar structure — matches the Figma admin designs, including icon choices.
 *
 * Notes:
 * - "Refunds" (module `refunds`) is the order-request / refund queue. It was
 *   briefly labelled "Returns"; renamed back to match the design.
 * - Reviews sits under CATALOGUE: reviews attach to products, and without an
 *   entry here the /reviews route was unreachable, so nothing could be moderated.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    heading: null,
    items: [{ label: 'Dashboard', path: '/', icon: RiDashboardLine, module: 'dashboard' }],
  },
  {
    heading: 'CATALOGUE',
    items: [
      { label: 'Products', path: '/products', icon: RiShoppingBag3Line, module: 'products' },
      { label: 'Categories', path: '/categories', icon: RiGridLine, module: 'categories' },
      { label: 'Inventory', path: '/inventory', icon: RiMenuLine, module: 'inventory' },
      { label: 'Reviews', path: '/reviews', icon: RiStarLine, module: 'reviews' },
    ],
  },
  {
    heading: 'OPERATIONS',
    items: [
      { label: 'Orders', path: '/orders', icon: RiShoppingBagLine, module: 'orders' },
      { label: 'Customers', path: '/customers', icon: RiUserLine, module: 'customers' },
      { label: 'Payments', path: '/payments', icon: RiWalletLine, module: 'payments' },
      { label: 'Refunds', path: '/refunds', icon: RiArrowLeftLine, module: 'refunds' },
    ],
  },
  {
    heading: 'GROWTH',
    items: [
      { label: 'Spinner Campaigns', path: '/spinner', icon: RiGiftLine, module: 'spinnerCampaigns' },
      { label: 'Coupons', path: '/coupons', icon: RiBookmarkLine, module: 'coupons' },
      { label: 'Affiliate Program', path: '/affiliate', icon: RiUserHeartLine, module: 'affiliateProgram' },
      { label: 'Banner', path: '/banner', icon: RiEyeLine, module: 'banner' },
      { label: 'Flash Sale', path: '/flash-sale', icon: RiFlashlightLine, module: 'flashSale' },
      { label: 'Notifications', path: '/notifications', icon: RiNotificationLine, module: 'notifications' },
    ],
  },
  {
    heading: 'INSIGHTS',
    items: [
      { label: 'Reports & Analytics', path: '/reports', icon: RiDashboardLine, module: 'reportsAnalytics' },
      { label: 'Settings', path: '/settings', icon: RiSettingsLine, module: 'settings' },
      { label: 'Sub Admin', path: '/sub-admin', icon: RiUserLine, module: 'subAdmin' },
      // `auditLogs` is `allow read: if isSuperAdmin()` in firestore.rules, so
      // the screen is super-admin-only whatever the module matrix says. It sits
      // next to Sub Admin because that is where the panel's admin-of-the-admins
      // tools live.
      {
        label: 'Audit Log',
        path: '/audit-log',
        icon: RiFileList3Line,
        module: 'subAdmin',
        superAdminOnly: true,
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
