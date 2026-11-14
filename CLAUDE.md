# CLAUDE.md

Context for Claude Code working in this repo.

## Product

"The Money Printer": a white room photo with a printer on a table. Visitors press **Print money**; a toy bill feeds out of the printer, slides off the tray, falls with paper physics and lands on a pile that grows with the global print count. Everyone gets 3 free prints (green bills). Ink packs: Small 5 / $0.99, Medium 30 / $2.99, Large 120 / $9.99. Paid ink prints gold bills. **Only Large** unlocks the photo flow: upload photo → name/short text/link → print. Clicking any bill opens a popup with its owner info.

Purchase flow: 1 Ink → 2 Pay (Stripe hosted, off-site) → 3 Photo (Large only) → 4 Print (Large only). Small/Medium return straight to the room.

Copy is English. The owner (Cleyton) speaks Portuguese; reply to him in pt-BR.

## Commands

- `npm run dev` — dev server (`?debug` calibration panel, `?lite` low-end mode)
- `npm run build` — typecheck + production build
- `npx tsx scripts/sim-bill.ts 20` — headless paper-physics run; use it after touching `src/physics/*` or `CONFIG.physics`
- `npx tsx scripts/sim-touch.ts` — headless check of pick-up / drop / under-the-table; run it after touching contacts or the heightfield
- `sh scripts/test-quota.sh` — checks the free-print rule against the deployed Supabase function

## Architecture rules

- All tunables live in `src/config.ts`. Don't scatter magic numbers.
- World units are metres, floor y = 0, +z toward the camera. The canvas is locked to the photo's aspect (`Stage.layout`), so calibration is resolution-independent.
- Bills render through `BillBatch` (one `InstancedMesh` per bill art). Per-instance deformation goes through the `aDeform`/`aDeform2` attributes and the shared GLSL in `billBatch.ts`. Keep the depth material patch in sync with the color material so shadows match.
- Physics is custom (`physics/billBody.ts`), no engine. Contacts are sequential impulses against `Heightfield` (2.5D: ignore points deeper than 5 cm, that is an overhang). Don't reintroduce penalty springs: they exploded with paper-light bodies.
- The pile is the heightfield plus `PileMesh`. Bills past `visualCap` are retired from the batch and live on only as pile height.
- UI is plain DOM in `ui/app.ts` driven by `store` (`state.ts`). Re-render the modal only when the screen changes; inputs update the store without re-rendering, so the caret is never lost.
- Escape user text with `esc()` before putting it in HTML. Links open with `rel="noopener noreferrer nofollow"`.

## Rules added on 2026-11-13

- **Free prints: 3 per rolling 24 h, counted on the server per IP and per device** (`supabase/migrations/001_free_quota.sql`, `supabase/functions/print`, `src/quota.ts`). The device clock is never trusted: the server answers `free` and `resetIn` (seconds). Without `VITE_SUPABASE_URL` the site runs in local test mode (wallet in localStorage, no 24 h rule). Live since 2026-11-14 on the Supabase project `money-printer` (ref `sqyuufrkpzaywpsfxgim`, us-east-1). The public URL and anon key are in `.env.local` (not in git); the local `supabase` shim cannot run `db push`, so SQL goes through the Management API or `npx supabase@latest`.
- **Photo on the bill** is engraved, not tinted: `engrave()` in `scene/billTexture.ts`, tunables in `CONFIG.portrait`.
- **Playing with the bills** (`main.ts` gesture block, `World.sweep/grab/grabMore/moveHeld/drop`, `CONFIG.touch`): tap opens the bill, drag spreads bills and shoves the pile, press-and-hold picks up one bill and then a handful. Local to each visitor until shared bills exist.
- **Heightfield is 2.5D.** `height(x, z, y)` returns the floor for a point more than `pile.overhang` under a surface (under the table/tray), and the lower level at a `pile.cliff` edge. Always pass `y` from physics code. Contact push-out is capped by `physics.maxPushOut`; uncapped it kicked bills back into the air.
- Mobile layouts are done: `Stage.layout` (portrait anchors the photo at the bottom, CSS mask fades the top) and the two media queries at the end of `style.css`.

## Not done yet (good next tasks)

1. Real Stripe Checkout: small backend (`/api/checkout`, webhook) — see `src/payments.ts`.
2. Global counter + shared bills (owner name/text/link/photo) from a backend; seed the pile from it.
3. Photo/text moderation before bills become public.
4. Realism roadmap in `docs/realismo.md` (PBD paper, table leg occluders, env map from the photo).
5. Move paid prints to the server with the Stripe webhook (free prints already are).

The design source lives in the Claude Design canvas "The Money Printer" (artboards: Desktop · sala, Compra 1–4, Nota aberta, Protótipo completo).
