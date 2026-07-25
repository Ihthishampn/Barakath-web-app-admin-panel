import type { Category } from '@barkath/shared';
import type { ImportError, ImportRow } from '../api/products';
import { validatePriceLadder } from './pricing';

export const IMPORT_COLUMNS = [
  'name',
  'category',
  'subcategory',
  'price',
  'offer',
  'stock',
  'description',
] as const;

/** A ready-to-fill template with the header row + one example line. */
export function importTemplateCsv(): string {
  const header = IMPORT_COLUMNS.join(',');
  const example = 'Amber Oud EDP,perfumes,attar,2499,1999,25,"A warm, resinous amber"';
  return `${header}\n${example}\n`;
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') {
      /* ignore, handled by \n */
    } else field += c;
  }
  // Trailing field/row (file may not end in newline).
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: ImportError[];
}

const rupeesToPaise = (s: string): number | null => {
  const n = Number(s.replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Turn raw CSV text into validated ImportRows. Every row is checked against the
 * category/sub-category catalogue and the shared price ladder; problems are
 * collected per line so the user sees exactly what to fix.
 */
export function validateImport(text: string, categories: Category[]): ParsedImport {
  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const table = parseCsv(text);
  if (table.length === 0) return { rows, errors: [{ line: 0, message: 'The file is empty.' }] };

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return { rows, errors: [{ line: 1, message: `Missing column(s): ${missing.join(', ')}.` }] };
  }
  const col = (name: (typeof IMPORT_COLUMNS)[number]) => header.indexOf(name);

  const catBySlug = new Map(categories.map((c) => [c.slug.toLowerCase(), c]));

  for (let r = 1; r < table.length; r++) {
    const line = r + 1; // 1-based, header is line 1
    const cells = table[r]!;
    const get = (name: (typeof IMPORT_COLUMNS)[number]) => (cells[col(name)] ?? '').trim();

    const name = get('name');
    const categorySlug = get('category').toLowerCase();
    const subCategorySlug = get('subcategory').toLowerCase();
    const price = rupeesToPaise(get('price'));
    const offerRaw = get('offer');
    const offer = offerRaw ? rupeesToPaise(offerRaw) : price;
    const stockRaw = get('stock');
    const stock = stockRaw ? Number(stockRaw) : 0;
    const description = get('description');

    if (!name) {
      errors.push({ line, message: 'Name is required.' });
      continue;
    }
    const cat = catBySlug.get(categorySlug);
    if (!cat) {
      errors.push({ line, message: `Unknown category “${get('category')}”.` });
      continue;
    }
    if (!cat.subCategories.some((s) => s.slug.toLowerCase() === subCategorySlug)) {
      errors.push({ line, message: `“${get('subcategory')}” is not a sub-category of ${cat.name}.` });
      continue;
    }
    if (price == null || price <= 0) {
      errors.push({ line, message: 'Price must be a number greater than 0.' });
      continue;
    }
    if (offer == null) {
      errors.push({ line, message: 'Offer is not a valid number.' });
      continue;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      errors.push({ line, message: 'Stock must be a whole number ≥ 0.' });
      continue;
    }
    const ladder = validatePriceLadder({ price: price / 100, offer: offer / 100, referral: '' });
    if (ladder.offer) {
      errors.push({ line, message: ladder.offer });
      continue;
    }

    rows.push({
      name,
      categorySlug,
      categoryTint: cat.categoryTint,
      subCategorySlug,
      pricePaise: price,
      offerPricePaise: offer,
      stock,
      description,
    });
  }

  return { rows, errors };
}
