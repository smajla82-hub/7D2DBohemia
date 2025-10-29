# Changelog

All notable changes for the Quest System module and integration are documented here.

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
