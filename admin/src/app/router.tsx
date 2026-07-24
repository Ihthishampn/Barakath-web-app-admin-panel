import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/routes/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { RequireModule } from '@/features/auth/RequireModule';
import { AppShell } from '@/components/layout/AppShell';
import { ModulePlaceholder } from '@/components/layout/ModulePlaceholder';
import { DashboardPage } from '@/features/dashboard/routes/DashboardPage';
import { ProductsListPage } from '@/features/products/routes/ProductsListPage';
import { ProductsFilterPage } from '@/features/products/routes/ProductsFilterPage';
import { ProductFormPage } from '@/features/products/routes/ProductFormPage';
import { CategoriesListPage } from '@/features/categories/routes/CategoriesListPage';
import { CategoryFormPage } from '@/features/categories/routes/CategoryFormPage';
import { SubCategoriesPage } from '@/features/categories/routes/SubCategoriesPage';
import { InventoryListPage } from '@/features/inventory/routes/InventoryListPage';
import { AdjustStockPage } from '@/features/inventory/routes/AdjustStockPage';
import { OrdersListPage } from '@/features/orders/routes/OrdersListPage';
import { OrderDetailPage } from '@/features/orders/routes/OrderDetailPage';
import { CustomersListPage } from '@/features/customers/routes/CustomersListPage';
import { CustomerProfilePage } from '@/features/customers/routes/CustomerProfilePage';
import { PaymentsListPage } from '@/features/payments/routes/PaymentsListPage';
import { ReturnsListPage } from '@/features/returns/routes/ReturnsListPage';
import { ReviewsListPage } from '@/features/reviews/routes/ReviewsListPage';
// Growth
import { SpinnerListPage } from '@/features/spinner/routes/SpinnerListPage';
import { CreateCampaignPage } from '@/features/spinner/routes/CreateCampaignPage';
import { CampaignDetailPage } from '@/features/spinner/routes/CampaignDetailPage';
import { CouponsListPage } from '@/features/coupons/routes/CouponsListPage';
import { CouponFormPage } from '@/features/coupons/routes/CouponFormPage';
import { AffiliateListPage } from '@/features/affiliate/routes/AffiliateListPage';
import { AllocateAffiliatePage } from '@/features/affiliate/routes/AllocateAffiliatePage';
import { BannerListPage } from '@/features/banner/routes/BannerListPage';
import { BannerFormPage } from '@/features/banner/routes/BannerFormPage';
import { FlashSaleListPage } from '@/features/flashsale/routes/FlashSaleListPage';
import { FlashSaleFormPage } from '@/features/flashsale/routes/FlashSaleFormPage';
import { NotificationsListPage } from '@/features/notifications/routes/NotificationsListPage';
import { NotificationCreatePage } from '@/features/notifications/routes/NotificationCreatePage';
// Insights
import { ReportsPage } from '@/features/reports/routes/ReportsPage';
import { SettingsPage } from '@/features/settings/routes/SettingsPage';
import { SubAdminListPage } from '@/features/subadmin/routes/SubAdminListPage';
import { SubAdminFormPage } from '@/features/subadmin/routes/SubAdminFormPage';
import { AuditLogPage } from '@/features/audit/routes/AuditLogPage';
import { ALL_NAV_ITEMS } from '@/components/layout/navConfig';

// Modules with real routes so far (exclude from the generic placeholder catch-all).
const BUILT = new Set<string>([
  '/', '/products', '/categories', '/inventory',
  '/orders', '/customers', '/payments', '/refunds', '/reviews',
  '/spinner', '/coupons', '/affiliate', '/banner', '/flash-sale', '/notifications',
  '/reports', '/settings', '/sub-admin', '/audit-log',
]);

const placeholderRoutes = ALL_NAV_ITEMS.filter((i) => !BUILT.has(i.path)).map((i) => ({
  path: `${i.path}/*`,
  element: <ModulePlaceholder />,
}));

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            // Module-level guard, inside the shell so a redirect never flashes a
            // bare page. Super admins pass straight through.
            element: <RequireModule />,
            children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/products', element: <ProductsListPage /> },
          { path: '/products/new', element: <ProductFormPage /> },
          { path: '/products/filter', element: <ProductsFilterPage /> },
          { path: '/products/:id', element: <ProductFormPage /> },
          { path: '/categories', element: <CategoriesListPage /> },
          { path: '/categories/new', element: <CategoryFormPage /> },
          { path: '/categories/:id/sub', element: <SubCategoriesPage /> },
          { path: '/categories/:id', element: <CategoryFormPage /> },
          { path: '/inventory', element: <InventoryListPage /> },
          { path: '/inventory/adjust', element: <AdjustStockPage /> },
          { path: '/orders', element: <OrdersListPage /> },
          { path: '/orders/:id', element: <OrderDetailPage /> },
          { path: '/customers', element: <CustomersListPage /> },
          { path: '/customers/:id', element: <CustomerProfilePage /> },
          { path: '/payments', element: <PaymentsListPage /> },
          { path: '/refunds', element: <ReturnsListPage /> },
          { path: '/reviews', element: <ReviewsListPage /> },

          // Growth
          { path: '/spinner', element: <SpinnerListPage /> },
          { path: '/spinner/new', element: <CreateCampaignPage /> },
          { path: '/spinner/:id', element: <CampaignDetailPage /> },
          { path: '/coupons', element: <CouponsListPage /> },
          { path: '/coupons/new', element: <CouponFormPage /> },
          { path: '/coupons/:id', element: <CouponFormPage /> },
          { path: '/affiliate', element: <AffiliateListPage /> },
          { path: '/affiliate/allocate', element: <AllocateAffiliatePage /> },
          { path: '/banner', element: <BannerListPage /> },
          { path: '/banner/new', element: <BannerFormPage /> },
          { path: '/banner/:id', element: <BannerFormPage /> },
          { path: '/flash-sale', element: <FlashSaleListPage /> },
          { path: '/flash-sale/new', element: <FlashSaleFormPage /> },
          { path: '/flash-sale/:id', element: <FlashSaleFormPage /> },
          { path: '/notifications', element: <NotificationsListPage /> },
          { path: '/notifications/create', element: <NotificationCreatePage /> },

          // Insights
          { path: '/reports', element: <ReportsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/sub-admin', element: <SubAdminListPage /> },
          { path: '/sub-admin/new', element: <SubAdminFormPage /> },
          { path: '/sub-admin/:id', element: <SubAdminFormPage /> },
          { path: '/audit-log', element: <AuditLogPage /> },
          ...placeholderRoutes,
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
