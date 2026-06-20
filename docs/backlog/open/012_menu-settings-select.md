# 012 Menu: pause, settings, select

Status: open (concept — to be refined)

## Context
006 ships menu + countdown + a 3-state machine (`menu|countdown|racing`).
Deferred as out of scope (`006:62-64`): pause/settings, track/kart select,
gamepad menu nav, camera blend, multi-language, credits. This item collects
the menu-system extensions that turn 006's start screen into a full front-end.
Camera blend, i18n, credits folded here as noted polish (may defer within).

## Goal
- Pause: new `paused` state in 006's machine; freezes physics+kart input,
  keeps render + dimmed overlay; resume/quit-to-menu. (Audio suspend via 005.)
- Settings: volume + mute (005 master), quality tier (shadows/res — ties to
  011), keybind remap (Input), audio/music balance. Persisted (localStorage).
- Track select: pick between circuits (requires multi-track — see deps).
- Kart select: pick kart (cosmetic + maybe tuning variant).
- Gamepad nav: D-pad/stick traversal of all menu screens + confirm (006 is
  keyboard+mouse only today).

## Non-goals
- Online profile / account settings
- Cloud save sync (local only)
- Full camera blend menu->race (acceptable snap stays; polish note)
- Multi-language + credits (defer within this item unless cheap)
- Replay theater, gallery

## Dependencies
006 (state machine, StartMenu/Countdown DOM pattern, `src/ui/`). 007 (track
select needs >0 finished circuit; kart select needs tunable kart). 005
(volume/mute/suspend). 011 (quality tier maps to perf knobs). Multi-track
(>1 circuit) gates meaningful track select — could land settings+pause first,
select later.

## Needs refinement
- Split: pause+settings first (deps satisfied early) vs select (needs tracks)?
  Likely two-phase inside one item
- State machine shape: add `paused` and `select`? or nest sub-states?
- Keybind remap UI complexity vs value (could defer to settings v2)
- Quality tier granularity (low/med/high? what each toggles)
- localStorage schema + versioning
- Gamepad nav: extend 006 StartMenu's listener model to all screens
