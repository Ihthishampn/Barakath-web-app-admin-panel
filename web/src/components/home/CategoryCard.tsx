import Link from 'next/link';
import { RiGiftLine, RiBookmarkLine, RiArchiveLine, RiHome4Line } from '@remixicon/react';
import type { Category } from '@barkath/shared';

/**
 * "Shop by category" tile — mirrors the Figma home design: a 182px card washed
 * in the category's own tint, with a translucent icon tile top-left and the
 * name + product count pinned to the bottom.
 *
 * The design uses a per-category gradient (a lightened tint → the tint). Since
 * the tint is admin-data, we reproduce it generically: a white wash that fades
 * out along the same 164° axis, layered over the tint.
 */
const ICONS = [RiGiftLine, RiBookmarkLine, RiArchiveLine, RiHome4Line];

export function CategoryCard({ category, index }: { category: Category; index: number }) {
  const Icon = ICONS[index % ICONS.length]!;
  const tint = category.categoryTint || '#efeeea';

  return (
    <Link
      href={`/c/${category.slug}`}
      className="flex h-[182px] flex-col justify-between rounded-[12px] p-[16px] transition-transform hover:-translate-y-0.5"
      style={{
        backgroundImage: `linear-gradient(164.2deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%)`,
        backgroundColor: tint,
      }}
    >
      <span className="grid h-[44px] w-[44px] place-items-center rounded-[8px] bg-white/70">
        <Icon size={22} className="text-text-primary" />
      </span>
      <span className="flex flex-col gap-[2px]">
        <span className="font-display text-[17px] font-extrabold text-text-primary">{category.name}</span>
        <span className="font-ui text-[12px] font-normal text-text-secondary">
          {category.productCount === 1 ? '1 product' : `${category.productCount ?? 0} products`}
        </span>
      </span>
    </Link>
  );
}
