/**
 * Full-screen auth chrome — no shop header/footer, no logo here (the sign-in /
 * register cards carry the single logo inside their dark brand panel, matching
 * the prototype). Each page fills the whole viewport.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-surface-app">{children}</main>;
}
