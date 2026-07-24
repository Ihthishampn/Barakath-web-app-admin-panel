# figma-library skill — install & setup

This skill makes Claude Code use your **real published Figma library components**
(via `importComponentByKeyAsync`) instead of redrawing icons from scratch.

It is a TEMPLATE: the recipe (rules + dump script) is universal, but the
component keys are specific to YOUR Figma library — so everyone generates their
own map once.

## 1. Install (into your project)

Unzip so the folder lands inside your project's `.claude/skills/` directory:

    <your-project>/.claude/skills/figma-library/

From your project root:

    mkdir -p .claude/skills
    cd .claude/skills
    unzip /path/to/figma-library.zip

The skill loads whenever you run Claude Code from this project. Add
`.claude/skills/figma-library/` to the repo if you want teammates on the same
project to get it automatically.

## 2. Requirements

- Claude Code with the **Figma MCP** connected and the `use_figma` write tool
  available (recent Figma desktop app).
- Your design system must be a **published team library** (only published
  libraries work with `importComponentByKeyAsync`).

## 3. Generate YOUR map (once, and after each republish)

In Claude Code, open your published library file in Figma, then ask:

    Run scripts/dump-components.js against my design-system library
    <paste your Figma library file URL>

Claude will:
1. Execute the dump via `use_figma` (in slices if the library is large).
2. Write the results into `references/component-map.md`
   (and `references/icons-map.md` if you have a separate icon file).
3. Fill in the library metadata (file keys, published status).

Then replace the placeholder example in `SKILL.md` with one real component from
your map.

## 4. Verify

Fresh session, no mention of the skill:

    Build a small frame with two product icons side by side.

The skill should auto-load, grep the icon map, and place REAL library instances
(linked to the library, updating when it updates) — not vector approximations.

## Notes

- Keys are library-specific. If you work across multiple design systems, keep a
  separate copy per project with its own map.
- List any deprecated/backup library files in SKILL.md rule #4 so their keys are
  never imported by mistake.
