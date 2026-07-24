import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { cap } from '@/lib/format';
import { useCategories } from '@/features/categories/api/categories';

type Filters = {
  category: string;
  sub: string;
  stock: 'all' | 'in' | 'low' | 'out';
  status: 'all' | 'active' | 'archived';
  flash: 'all' | 'yes';
  min: string;
  max: string;
};

const DEFAULTS: Filters = { category: 'all', sub: 'all', stock: 'all', status: 'all', flash: 'all', min: '0', max: '5000' };

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-5">
      <div className="mb-3 font-ui text-[13px] font-bold text-text-primary">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-sm border px-3.5 py-2 font-ui text-xs font-semibold transition-colors',
              value === o.value
                ? 'border-brand-primary bg-brand-primary text-white'
                : 'border-border-default bg-surface-card text-text-secondary hover:border-brand-primary hover:text-brand-primary',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProductsFilterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: categories } = useCategories();

  const [f, setF] = useState<Filters>({
    category: params.get('category') ?? DEFAULTS.category,
    sub: params.get('sub') ?? DEFAULTS.sub,
    stock: (params.get('stock') as Filters['stock']) ?? DEFAULTS.stock,
    status: (params.get('status') as Filters['status']) ?? DEFAULTS.status,
    flash: (params.get('flash') as Filters['flash']) ?? DEFAULTS.flash,
    min: params.get('min') ?? DEFAULTS.min,
    max: params.get('max') ?? DEFAULTS.max,
  });

  const set = (patch: Partial<Filters>) => setF((prev) => ({ ...prev, ...patch }));

  const catOptions = [
    { value: 'all', label: 'All' },
    ...categories.map((c) => ({ value: c.slug, label: c.name })),
  ];
  const selectedCat = categories.find((c) => c.slug === f.category);
  const subOptions = [
    { value: 'all', label: 'All' },
    ...(selectedCat?.subCategories.map((s) => ({ value: s.slug, label: s.name })) ?? []),
  ];

  const apply = () => {
    const qs = new URLSearchParams();
    (Object.keys(DEFAULTS) as (keyof Filters)[]).forEach((k) => {
      if (f[k] && f[k] !== DEFAULTS[k]) qs.set(k, String(f[k]));
    });
    navigate(`/products${qs.toString() ? `?${qs}` : ''}`);
  };

  return (
    <div className="px-7 py-6">
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          Filter products
        </h1>
        <div className="flex gap-2.5">
          <button
            onClick={() => setF(DEFAULTS)}
            className="h-[42px] rounded-sm px-4 font-ui text-[13px] font-bold text-text-secondary hover:bg-surface-app"
          >
            Reset
          </button>
          <Button variant="primary" className="h-[42px]" onClick={apply}>
            Apply filters
          </Button>
        </div>
      </div>

      <div className="max-w-[720px]">
        <div className="rounded-md border border-border-subtle bg-surface-card p-5">
          <ChipRow
            label="Category"
            options={catOptions}
            value={f.category}
            onChange={(v) => set({ category: v, sub: 'all' })}
          />
          <ChipRow label="Sub-category" options={subOptions} value={f.sub} onChange={(v) => set({ sub: v })} />
          <ChipRow
            label="Stock status"
            options={[
              { value: 'all', label: 'All' },
              { value: 'in', label: 'In stock' },
              { value: 'low', label: 'Low stock' },
              { value: 'out', label: 'Out of stock' },
            ]}
            value={f.stock}
            onChange={(v) => set({ stock: v as Filters['stock'] })}
          />
          <ChipRow
            label="Product status"
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
            value={f.status}
            onChange={(v) => set({ status: v as Filters['status'] })}
          />
          <ChipRow
            label="Flash sale"
            options={[
              { value: 'all', label: 'All' },
              { value: 'yes', label: 'In flash sale' },
            ]}
            value={f.flash}
            onChange={(v) => set({ flash: v as Filters['flash'] })}
          />

          <div>
            <div className="mb-3 font-ui text-[13px] font-bold text-text-primary">Price range</div>
            <div className="flex max-w-[320px] gap-3">
              {(['min', 'max'] as const).map((k) => (
                <label key={k} className="flex flex-1 flex-col gap-1.5">
                  <span className="font-ui text-xs font-bold text-text-primary">{cap(k)}</span>
                  <div className="flex items-center rounded-sm border border-border-default px-3 py-2.5">
                    <span className="mr-1 font-ui text-[13px] text-text-tertiary">₹</span>
                    <input
                      type="number"
                      min={0}
                      value={f[k]}
                      onChange={(e) => set({ [k]: e.target.value } as Partial<Filters>)}
                      className="w-full bg-transparent font-ui text-[13px] text-text-primary focus:outline-none"
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
