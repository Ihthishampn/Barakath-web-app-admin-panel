// dump-components.js
// Run this INSIDE your published design-system / icon library file via the
// use_figma tool. It walks every page and returns a JSON array describing every
// COMPONENT and COMPONENT_SET (name, key, and variant property definitions for
// sets). Variant children inside a set are skipped — you address those through
// the set key + setProperties().
//
// IMPORTANT: use_figma tool output truncates around ~20KB. For large libraries
// (hundreds/thousands of components) dump in SLICES using SLICE / SIZE below.
// Run once per slice, incrementing SLICE, and concatenate the results.
//
// Usage: paste the body into use_figma. Adjust SLICE (0-based) and SIZE.

const SLICE = 0;     // which slice to return (0, 1, 2, ...)
const SIZE = 150;    // components per slice; lower this if output still truncates

// Load every page (findAll requires pages loaded in dynamic-page documents).
await figma.loadAllPagesAsync();

const out = [];
for (const page of figma.root.children) {
  const nodes = page.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
  for (const n of nodes) {
    // Skip variant children that live inside a COMPONENT_SET.
    if (n.parent && n.parent.type === "COMPONENT_SET") continue;

    const entry = { name: n.name, key: n.key, type: n.type, page: page.name };

    if (n.type === "COMPONENT_SET") {
      try {
        const defs = n.componentPropertyDefinitions;
        entry.variants = Object.fromEntries(
          Object.entries(defs).map(([prop, def]) => [
            prop,
            def.variantOptions || def.defaultValue,
          ])
        );
      } catch (e) {
        // Broken set (inconsistent variant properties) — surfaced as an audit.
        entry.error = String(e.message || e);
      }
    }
    out.push(entry);
  }
}

// Stable order so slicing is deterministic across runs.
out.sort((a, b) => (a.page + a.name).localeCompare(b.page + b.name));

const total = out.length;
const start = SLICE * SIZE;
const slice = out.slice(start, start + SIZE);

return JSON.stringify(
  { total, slice: SLICE, size: SIZE, returned: slice.length, start, items: slice },
  null,
  0
);
