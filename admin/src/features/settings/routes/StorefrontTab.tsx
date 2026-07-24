import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RiCloseLine, RiAddLine } from '@remixicon/react';
import type { AnnouncementItem } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsShell } from '../components/SettingsShell';
import { Card, CardTitle, Field, ToggleRow, inputCls } from '../components/fields';
import {
  saveAnnouncement,
  saveReturns,
  saveSearchSuggestions,
  useAnnouncement,
  useReturns,
  useSearchSuggestions,
} from '../api/settings';

const MAX_SUGGESTIONS = 8;
const MAX_ANNOUNCEMENTS = 6;

let _aid = 0;
const newAnnId = () => `a_${Date.now()}_${_aid++}`;

/**
 * Storefront settings — the three storefront-facing knobs that have no home of
 * their own: the announcement strip, the search screen's quick chips and the
 * return window.
 *
 * Each card saves independently so a validation problem in one doesn't block
 * the others. The storefront falls back to its built-in defaults whenever a
 * doc is missing, so an untouched install still renders correctly.
 */
export function StorefrontTab() {
  return (
    <SettingsShell active="storefront" subtitle="Announcement bar, search suggestions and returns.">
      <div className="flex max-w-[640px] flex-col gap-4">
        <AnnouncementCard />
        <SuggestionsCard />
        <ReturnsCard />
      </div>
    </SettingsShell>
  );
}

// ── Announcement strip (carousel of one or more messages) ────────────
function AnnouncementCard() {
  const { data, loading } = useAnnouncement();
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const canEdit = useCanDo('settings', 'edit');
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<AnnouncementItem[]>([]);

  useEffect(() => {
    if (seeded || (loading && !data)) return;
    setActive(data?.active ?? true);
    // Prefer the new items list; fall back to the legacy single message so an
    // older doc opens as a one-entry carousel rather than empty.
    const existing = data?.items?.length
      ? data.items
      : data?.message
        ? [{ id: newAnnId(), message: data.message, linkLabel: data.linkLabel ?? null, linkUrl: data.linkUrl ?? null }]
        : [{ id: newAnnId(), message: '', linkLabel: null, linkUrl: null }];
    setItems(existing.map((i) => ({ ...i, id: i.id || newAnnId() })));
    setSeeded(true);
  }, [data, loading, seeded]);

  const patch = (id: string, p: Partial<AnnouncementItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));
  const add = () => {
    if (items.length >= MAX_ANNOUNCEMENTS) return toast.error(`Up to ${MAX_ANNOUNCEMENTS} announcements.`);
    setItems((xs) => [...xs, { id: newAnnId(), message: '', linkLabel: null, linkUrl: null }]);
  };

  const onSave = async () => {
    // Drop blank rows, trim, and validate that every link is a storefront path.
    const cleaned = items
      .map((i) => ({
        id: i.id,
        message: i.message.trim(),
        linkLabel: i.linkLabel?.trim() || null,
        linkUrl: i.linkUrl?.trim() || null,
      }))
      .filter((i) => i.message);
    for (const i of cleaned) {
      if (i.linkUrl && !i.linkUrl.startsWith('/')) {
        return toast.error('Each link URL must be a storefront path starting with “/”.');
      }
    }
    setSaving(true);
    try {
      await saveAnnouncement({
        id: 'announcement',
        active,
        items: cleaned,
        // Keep the legacy single-message fields mirrored to the first entry.
        message: cleaned[0]?.message ?? '',
        linkLabel: cleaned[0]?.linkLabel ?? null,
        linkUrl: cleaned[0]?.linkUrl ?? null,
      });
      toast.success('Announcements saved');
    } catch {
      toast.error('Could not save the announcements.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <CardSpinner />;

  return (
    <Card>
      <CardTitle>Announcement bar</CardTitle>
      <p className="mb-3.5 font-ui text-[11px] text-text-tertiary">
        Add one or more messages — the storefront rotates through them automatically.
      </p>
      <div className="flex flex-col gap-3.5">
        {items.map((it, idx) => (
          <div key={it.id} className="rounded-sm border border-border-subtle bg-surface-app/40 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="font-ui text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                Message {idx + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  aria-label={`Remove message ${idx + 1}`}
                  className="text-text-tertiary transition-colors hover:text-error"
                >
                  <RiCloseLine size={15} />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <Field
                label="Message"
                value={it.message}
                onChange={(v) => patch(it.id, { message: v })}
                placeholder="Free delivery on Eid orders over ₹1,499"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Link label"
                  value={it.linkLabel ?? ''}
                  onChange={(v) => patch(it.id, { linkLabel: v })}
                  placeholder="Shop the collection"
                />
                <Field
                  label="Link URL"
                  value={it.linkUrl ?? ''}
                  onChange={(v) => patch(it.id, { linkUrl: v })}
                  placeholder="/listing"
                />
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" className="h-[38px] self-start" onClick={add}>
          <RiAddLine size={15} /> Add announcement
        </Button>

        <ToggleRow
          label="Show on storefront"
          hint="Turn off to hide the whole strip. Blank messages are ignored."
          divided
        >
          <Toggle checked={active} onChange={setActive} />
        </ToggleRow>
        <div>
          <Button variant="primary" className="h-[42px]" loading={saving} disabled={!canEdit} title={canEdit ? undefined : noPermissionTitle('settings', 'edit')} onClick={() => void onSave()}>
            Save announcements
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Search suggestions ───────────────────────────────────────────────
function SuggestionsCard() {
  const { data, loading } = useSearchSuggestions();
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const canEdit = useCanDo('settings', 'edit');
  const [terms, setTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (seeded || (loading && !data)) return;
    setTerms(data?.terms ?? []);
    setSeeded(true);
  }, [data, loading, seeded]);

  const add = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    if (terms.length >= MAX_SUGGESTIONS) return toast.error(`Up to ${MAX_SUGGESTIONS} suggestions.`);
    if (terms.includes(t)) return toast.error('That suggestion is already in the list.');
    setTerms([...terms, t]);
    setDraft('');
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await saveSearchSuggestions(terms);
      toast.success('Search suggestions saved');
    } catch {
      toast.error('Could not save search suggestions.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <CardSpinner />;

  return (
    <Card>
      <CardTitle>Search suggestions</CardTitle>
      <p className="mb-3.5 font-ui text-[11px] text-text-tertiary">
        Quick chips shown on the storefront search screen before anything is typed. Leave empty to
        use the built-in defaults.
      </p>
      <div className="flex flex-col gap-3.5">
        {terms.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {terms.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-pill border border-border-default bg-surface-app px-3 py-1.5 font-ui text-[12px] font-semibold text-text-secondary"
              >
                {t}
                <button
                  type="button"
                  onClick={() => setTerms(terms.filter((x) => x !== t))}
                  aria-label={`Remove ${t}`}
                  className="text-text-tertiary transition-colors hover:text-error"
                >
                  <RiCloseLine size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="amber perfume"
            className={inputCls}
          />
          <Button variant="outline" className="h-[42px] flex-none" onClick={add}>
            Add
          </Button>
        </div>
        <div>
          <Button variant="primary" className="h-[42px]" loading={saving} disabled={!canEdit} title={canEdit ? undefined : noPermissionTitle('settings', 'edit')} onClick={() => void onSave()}>
            Save suggestions
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Returns ──────────────────────────────────────────────────────────
function ReturnsCard() {
  const { data, loading } = useReturns();
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const canEdit = useCanDo('settings', 'edit');
  const [windowDays, setWindowDays] = useState('7');
  const [autoRefundToWallet, setAutoRefundToWallet] = useState(true);

  useEffect(() => {
    if (seeded || (loading && !data)) return;
    setWindowDays(String(data?.windowDays ?? 7));
    setAutoRefundToWallet(data?.autoRefundToWallet ?? true);
    setSeeded(true);
  }, [data, loading, seeded]);

  const onSave = async () => {
    const days = Number(windowDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) {
      return toast.error('Return window must be a whole number of days between 0 and 90.');
    }
    setSaving(true);
    try {
      await saveReturns({ id: 'returns', windowDays: days, autoRefundToWallet });
      toast.success('Return settings saved');
    } catch {
      toast.error('Could not save return settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <CardSpinner />;

  return (
    <Card>
      <CardTitle>Returns</CardTitle>
      <div className="flex flex-col gap-4">
        <div>
          <Field
            label="Return window"
            value={windowDays}
            onChange={setWindowDays}
            type="number"
            inputMode="numeric"
            suffix="days"
          />
          <p className="mt-1.5 font-ui text-[11px] text-text-tertiary">
            Days after delivery a customer can raise a return. Set 0 to disable returns entirely.
          </p>
        </div>
        <ToggleRow
          label="Auto-refund to wallet"
          hint="Approved returns credit the customer’s Barakath wallet."
          divided
        >
          <Toggle checked={autoRefundToWallet} onChange={setAutoRefundToWallet} />
        </ToggleRow>
        <div>
          <Button variant="primary" className="h-[42px]" loading={saving} disabled={!canEdit} title={canEdit ? undefined : noPermissionTitle('settings', 'edit')} onClick={() => void onSave()}>
            Save returns
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CardSpinner() {
  return (
    <Card>
      <div className="grid place-items-center py-10">
        <Spinner className="h-6 w-6 text-brand-primary" />
      </div>
    </Card>
  );
}
