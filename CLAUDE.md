# DepFlow — context for the coding agent

You are building **DepFlow**, a mobile-first project-planning tool for developers.

## Start here
1. Read `REQUIREMENTS.md` — full functional spec, build order, design tokens.
2. Read `data-model.json` — entity shapes, seed data, the layer/wave algorithm, and expected test outputs.
3. Open `prototype.html` in a browser — this is the **visual reference** for look, feel, and interactions. It is an in-memory mock; do not treat its code as the architecture.

## The one thing not to get wrong
Two independent axes on every issue:
- **Layer** = computed from dependencies, read-only ("what can I start now").
- **Wave** = manual delivery sprint ("what am I shipping now").

The "Ordine" view filters by the active wave and computes layers from that wave's issues only. But an issue's detail sheet shows ALL its dependencies across all waves, with each tagged by its wave and marked done if applicable. Cross-wave dependencies never block the wave-filtered view.

## Suggested first slice
Build through step 5 of the build order in REQUIREMENTS.md (data layer → layer/wave engine → project list → project detail tabs → Ordine tab). That alone is usable. Validate the engine against `_EXPECTED_LAYERS` in data-model.json before building UI on top of it.

## Stack notes
Mobile-first, dark theme, bottom sheets. Persistence target: Supabase fits the example. Adjust to your team's stack.
