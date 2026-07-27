'use client';

/**
 * Account content wrapper — renders just the page title + content for the
 * account area's right-hand column.
 *
 * The profile sidebar, the auth gate (loading / signed-out) and the log-out
 * flow all live in the persistent route layout now
 * (app/(shop)/account/layout.tsx), so they survive navigation between tabs
 * instead of being rebuilt by every page. This component stays only so the
 * existing pages can keep wrapping their content in `<AccountShell title=…>`
 * without change — it no longer draws any chrome of its own.
 */
export function AccountShell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <>
      {title && <h1 className="mb-5 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text-primary">{title}</h1>}
      {children}
    </>
  );
}
