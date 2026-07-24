import { RiShieldCheckLine, RiFlashlightLine, RiLineChartLine, RiLockPasswordLine } from '@remixicon/react';
import { LoginForm } from '../components/LoginForm';

/**
 * Admin login — the prototype has no login screen, so this is an original,
 * brand-forward split layout: a deep evergreen panel (primary color) on the
 * left, a clean sign-in form on the right. No logo, per request.
 */
export function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* ── Brand panel (evergreen primary) ───────────────────────── */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-14 text-white lg:flex"
        style={{ background: 'linear-gradient(150deg, #0f7a5a 0%, #0b5e46 55%, #073d2e 100%)' }}
      >
        {/* soft gold + white glows */}
        <div className="pointer-events-none absolute -right-24 -top-28 h-[420px] w-[420px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(218,162,39,0.30), transparent 70%)' }} />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-[380px] w-[380px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.10), transparent 70%)' }} />

        <div className="relative">
          <div className="font-display text-2xl font-extrabold tracking-[0.14em] text-brand-gold">BARAKATH</div>
          <div className="mt-1 font-ui text-[11px] font-bold uppercase tracking-[0.22em] text-white/60">Enterprise Admin</div>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-[40px] font-extrabold leading-[1.1] tracking-[-0.02em]">
            Run the whole store from <span className="text-brand-gold">one place.</span>
          </h1>
          <p className="mt-4 font-ui text-[15px] leading-relaxed text-white/75">
            Catalogue, orders, payments, growth and insights — managed with speed, control and clarity.
          </p>

          <div className="mt-9 flex flex-col gap-3.5">
            <Feature icon={<RiFlashlightLine size={18} />} text="Real-time catalogue & inventory" />
            <Feature icon={<RiLineChartLine size={18} />} text="Live orders, payments & analytics" />
            <Feature icon={<RiShieldCheckLine size={18} />} text="Role-based access, fully audited" />
          </div>
        </div>

        <div className="relative font-ui text-xs text-white/45">© 2026 Barakath Retail Pvt Ltd · India</div>
      </aside>

      {/* ── Sign-in form ──────────────────────────────────────────── */}
      <section className="flex items-center justify-center bg-surface-app px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* mobile brand mark (panel is hidden < lg) */}
          <div className="mb-8 lg:hidden">
            <div className="font-display text-xl font-extrabold tracking-[0.14em] text-brand-primary">BARAKATH</div>
            <div className="mt-0.5 font-ui text-[10px] font-bold uppercase tracking-[0.22em] text-text-tertiary">Enterprise Admin</div>
          </div>

          <span className="inline-flex items-center gap-2 rounded-pill bg-brand-primary-subtle px-3 py-1 font-ui text-[11px] font-bold text-brand-primary">
            <RiLockPasswordLine size={13} /> Secure sign in
          </span>
          <h2 className="mt-4 font-display text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-text-primary">
            Welcome back
          </h2>
          <p className="mt-1.5 font-ui text-sm text-text-secondary">Sign in to your Barakath admin panel.</p>

          <div className="mt-7">
            <LoginForm />
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 font-ui text-[11px] text-text-tertiary">
            <RiShieldCheckLine size={14} className="text-brand-primary" />
            Protected by two-factor authentication
          </div>
        </div>
      </section>
    </main>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-pill bg-white/10 text-brand-gold ring-1 ring-white/15">
        {icon}
      </span>
      <span className="font-ui text-sm font-medium text-white/90">{text}</span>
    </div>
  );
}
