# Changelog

All notable changes for the Quest System module and integration are documented here.

## [Unreleased] - 2026-08-08
### Fixed
- **BohemiaServerHub icon disappearing from `windowPagingHeader` (7D2D v3.1)**: The green "B" HUB icon button went through several iterations while chasing 7D2D v3.1 XUi compatibility. Documenting the full history here so future modding on this button doesn't repeat the same dead ends.

  | Version | XUi element | Icon visible | Click sound | Opens window |
  |---|---|---|---|---|
  | 2.6 (pre-3.1) | `<button>` with child `<label>` | ✅ | ✅ | ❌ |
  | 3.0a | `<button>` + paging nav attrs (`selectable`, `collider_scale`, `snap`, `gamepad_selectable`) + child `<label>` | ✅ | ✅ | ❌ |
  | 3.0b | `<iconbutton>` with child `<label>` | ❌ (icon vanished entirely) | – | – |
  | **3.0c (current)** | `<iconbutton>` with **no children** + `<label>` as a **sibling** at the same `pos`, higher `depth` | ✅ | ✅ | ✅ |

  **Root cause**: 7D2D v3.1's `WindowSelector` (the controller behind `windowPagingHeader`) only wires up paging navigation for `<iconbutton>` elements — matching every vanilla icon in that header (Crafting, Character, Map, Skills, etc.), none of which have child elements. Adding paging-nav attributes to a plain `<button>` (3.0a) made it look and sound right but never registered with `WindowSelector`, so it never opened its target window. Nesting a `<label>` inside `<iconbutton>` (3.0b) is apparently unsupported by that component and silently discards the whole icon at parse/render time, rather than just ignoring the label.

  **Fix**: Keep `<iconbutton>` completely "clean" (no children), exactly like vanilla. Render the "B" text as an independent sibling `<label>` positioned at the same `pos="576,-21"` with a higher `depth`, so it visually overlays the iconbutton without being nested inside it.

  **Rule of thumb for future XUi work in this mod**: `<iconbutton>` in 7D2D v3.1 must not have child elements. If you need a label/overlay on top of an iconbutton, add it as a sibling at the same position with a higher depth instead.

  Files: `PROJECT HUB/BohemiaServerHub/Config/XUi_InGame/windows.xml`
  Commits: `32a7244` (Path A attempt, superseded), `e16a66b` (Path B, working fix)

## [0.3.9] - 2025-10-29
Robust quest tracking on a busy live server (Bohemia). Fixes time quests, prevents post-reset auto-complete, and adds safe retention for variables. Tagged in Takaro as v0.3.9.

### Added
- Budgeted quest tracker cron (events → external sync → time), safe on live servers.
- Per-player per-day reset stamp (`dailyquests_player_reset_at_{playerId}_{date}`) used to clamp time streaks.
- Cleanup cron to set `expiresAt` on older variables and keep storage under control.
- Targets for time quests populated from config (`targets.timespentMinutes` / `targets.unkillableMinutes`) or `*Ms` alternatives.
- Optional log-noise reduction in the Python integration (`urllib3` at WARNING).

### Changed
- Active-type gating for all updates.
- Exact-key lookups for time sessions (`session_*`, `deathless_session_*`, `deathless_start_*`) using today’s `dailyquest_*` owners.
- Backfill `target` on quest payloads so `/daily` always shows `HhMm/HhMm`.
- External sync (vote/levelgain) picks best source and preserves claimed/completed flags.
- `resetmydaily` initializes 5 daily quests + “always” and sets `expiresAt` using `retentionDays` (default 7).

### Fixed
- Tracker task timeouts on live server.
- Time quests showing `0h00m/0h00m`.
- Post-reset auto-completion of UNKILLABLE from stale `deathless_start_*`.
- Occasional moduleId/gsId/date drift in cross-module sync.

### Ops
- `retentionDays` config (default 7).
- Cleanup cron updates are DTO-safe by preserving `value` when adding `expiresAt`.
- Optional INFO-level root logger in Python integration.

## [0.3.8] - 2025-10-28
Interim internal testing builds.

## [0.2.1] - 2025-10-xx
Baseline prior to Bohemia hardening.
