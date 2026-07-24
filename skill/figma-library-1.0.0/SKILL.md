---
name: figma-library
description: Use this skill for ANY task that creates, builds, or edits UI, screens, components, icons, or layouts in Figma using a design system. Loads the component/icon key maps so real published library components are instantiated via importComponentByKeyAsync instead of being redrawn from primitives.
---


# Figma Design System Library

Your published design system lives in Figma. When building screens, ALWAYS use
real library components — never approximate them.

> SETUP REQUIRED: The maps in `references/` start empty. Before this skill can
> import anything, run `scripts/dump-components.js` against YOUR published
> library and paste the output into the reference tables. See README.md.

## Hard rules

1. **NEVER rebuild icons or components from primitives** (vectors, circles,
   rectangles, ellipses, text, or grouped paths). If it exists in the library,
   instantiate it.
2. **ALWAYS instantiate via `importComponentByKeyAsync` / `importComponentSetByKeyAsync`**
   using a key from the maps in `references/`.
3. **If a component is missing from the map, STOP and ASK.** Do not improvise a
   replacement. Do not guess a key.
4. **NEVER import from deprecated/backup files.** (List them here once known —
   e.g. "NEVER import from file key XXX, the old design system backup.")
5. **Do not load `references/icons-map.md` fully into context.** It is large.
   Always `grep` for the icon name and read only the matching lines.

## How to find a key

- Components / component sets → read `references/component-map.md`.
- Individual icon glyphs → `grep` the icon name in `references/icons-map.md`,
  read only matching lines. Duplicate names may return multiple hits; pick the
  best match (a wrong pick is a fast fix in review).

## Import pattern (copy-pasteable)

```js
// single component
const c = await figma.importComponentByKeyAsync("KEY_FROM_MAP");
const inst = c.createInstance();

// component set with variants
const set = await figma.importComponentSetByKeyAsync("SET_KEY_FROM_MAP");
const inst = set.defaultVariant.createInstance();
inst.setProperties({ "Style": "linear", "Size": "24px" });
```

## Concrete example — your most-used component

<!-- After running the dump, replace this with a REAL component + key from your
     own map. Concrete examples beat abstract ones for reliability. -->
```js
// Primary button (example — replace the key with one from your map)
const set = await figma.importComponentSetByKeyAsync("REPLACE_WITH_YOUR_BUTTON_SET_KEY");
const btn = set.defaultVariant.createInstance();
btn.setProperties({ "Variant": "primary", "Size": "medium" });
```

## Regenerating the maps

When new components are published, rerun `scripts/dump-components.js` inside the
library file via `use_figma` and rewrite the reference tables. The maps are a
snapshot — regenerating is part of your publish workflow.

## Before ANY use_figma call

Load the `/figma-use` skill first (it is mandatory before `use_figma`).
