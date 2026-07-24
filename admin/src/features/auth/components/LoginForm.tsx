import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { AuthError, resetPassword, signInAdmin } from '../api/auth';
import { useAuthStore } from '../stores/authStore';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAdmin = useAuthStore((s) => s.setAdmin);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    // Dev convenience: prefill the super-admin so `pnpm dev` is one click.
    //
    // Gated on import.meta.env.DEV, NOT on env.useEmulators — useEmulators is
    // false in both .env files, so these credentials point at the real project
    // barkath-25607. import.meta.env.DEV is true only under the Vite dev server
    // and is statically false in `vite build`, so the production bundle ships
    // empty fields and the password is never compiled into it (it previously
    // was — grep found it in admin/dist/assets/index-*.js).
    //
    // Override per-machine with VITE_DEV_ADMIN_EMAIL / VITE_DEV_ADMIN_PASSWORD
    // in admin/.env.local (gitignored) rather than editing this file.
    defaultValues: import.meta.env.DEV
      ? {
          email: import.meta.env.VITE_DEV_ADMIN_EMAIL ?? 'admin@barkath.app',
          password: import.meta.env.VITE_DEV_ADMIN_PASSWORD ?? 'Barkath@123',
        }
      : { email: '', password: '' },
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      const admin = await signInAdmin(values.email, values.password);
      setAdmin(admin);
      const to = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(to, { replace: true });
      toast.success(`Welcome back, ${admin.name.split(' ')[0]}`);
    } catch (e) {
      toast.error(e instanceof AuthError ? e.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const onForgot = async () => {
    const email = (getValues('email') ?? '').trim();
    if (!email) {
      toast.error('Enter your email first, then tap “Forgot password”.');
      return;
    }
    try {
      setResetting(true);
      await resetPassword(email);
      toast.success(`Password reset link sent to ${email}`);
    } catch {
      toast.error('Could not send the reset email. Check the address and try again.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Email"
        type="email"
        autoComplete="username"
        placeholder="you@barkath.app"
        error={errors.email?.message}
        {...register('email')}
      />
      <TextField
        label="Password"
        reveal
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message}
        {...register('password')}
      />

      <div className="-mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={() => void onForgot()}
          disabled={resetting}
          className="font-ui text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50"
        >
          {resetting ? 'Sending…' : 'Forgot password?'}
        </button>
      </div>

      <Button type="submit" size="lg" block loading={submitting}>
        Sign in
      </Button>
    </form>
  );
}
