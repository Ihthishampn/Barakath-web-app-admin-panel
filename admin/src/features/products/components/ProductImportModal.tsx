import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { RiCloseLine, RiDownloadLine, RiUploadCloud2Line, RiCheckboxCircleLine, RiErrorWarningLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { downloadText } from '@/lib/exportCsv';
import { useCategories } from '@/features/categories/api/categories';
import { importProducts, type ImportError } from '../api/products';
import { importTemplateCsv, validateImport, type ParsedImport } from '../lib/csv';

/**
 * Bulk-import simple products from a CSV. Downloads a template, validates every
 * row against the live category catalogue + price ladder, and only enables
 * import when at least one row is valid. Rows with errors are reported by line.
 */
export function ProductImportModal({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const { data: categories } = useCategories();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [importing, setImporting] = useState(false);

  const onFile = async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setParsed(validateImport(text, categories));
  };

  const runImport = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    try {
      setImporting(true);
      const n = await importProducts(parsed.rows);
      toast.success(`Imported ${n} product${n > 1 ? 's' : ''} as drafts`);
      onDone(n);
    } catch {
      toast.error('Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">Import products</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
            <RiCloseLine size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="font-ui text-[13px] leading-relaxed text-text-secondary">
            Upload a CSV with columns <span className="font-semibold text-text-primary">name, category, subcategory, price, offer, stock, description</span>.
            Category &amp; sub-category must match existing slugs. Imported items are created as
            <span className="font-semibold text-text-primary"> drafts</span>, ready to add images and publish.
          </p>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button variant="outline" size="sm" onClick={() => downloadText('barkath-products-template.csv', importTemplateCsv())}>
              <RiDownloadLine size={15} className="mr-1.5" /> Download template
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <RiUploadCloud2Line size={15} className="mr-1.5" /> {fileName ? 'Choose another file' : 'Choose CSV file'}
            </Button>
          </div>
          {fileName && <p className="mt-2 font-ui text-xs text-text-tertiary">Selected: {fileName}</p>}

          {parsed && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-success-subtle px-2.5 py-1.5 font-ui text-xs font-bold text-success">
                  <RiCheckboxCircleLine size={15} /> {parsed.rows.length} ready
                </span>
                {parsed.errors.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-error-subtle px-2.5 py-1.5 font-ui text-xs font-bold text-error">
                    <RiErrorWarningLine size={15} /> {parsed.errors.length} to fix
                  </span>
                )}
              </div>

              {parsed.errors.length > 0 && (
                <div className="max-h-[180px] overflow-y-auto rounded-md border border-border-subtle">
                  {parsed.errors.map((e: ImportError, i) => (
                    <div key={i} className="flex gap-3 border-b border-border-subtle px-3 py-2 font-ui text-xs last:border-0">
                      <span className="flex-none font-bold text-text-tertiary">Line {e.line}</span>
                      <span className="text-text-secondary">{e.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-border-subtle p-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={importing} disabled={!parsed || parsed.rows.length === 0} onClick={runImport}>
            {parsed && parsed.rows.length > 0 ? `Import ${parsed.rows.length} product${parsed.rows.length > 1 ? 's' : ''}` : 'Import'}
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
