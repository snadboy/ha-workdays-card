# Workdays Card

A month grid of **workday checkboxes** for Home Assistant. Tick a day to make it a workday,
untick it to make it a day off. Badges say *why* a day is not a workday:
**H** = holiday, **M** = your own override.

Built to drive the [Scheduler component](https://github.com/nielsfaber/scheduler-component):
schedules set to `weekdays: [workday]` follow whatever this card says.

---

## How it works

Three sources combine into one answer per day:

| Source | Role |
|---|---|
| `binary_sensor.workday_base` (Workday integration) | default workdays — `attributes.workdays`, e.g. Mon–Fri |
| `calendar.workday_sensor_us_calendar` (Workday integration) | the per-date truth: weekends and public holidays already removed |
| `calendar.days_off` (Local Calendar, yours) | your manual overrides |

A day is a workday when the Workday calendar has an event for it — **unless** you override it:

- **`Day off`** event → not a workday (badge **M**)
- **`Workday`** event → a workday even if it is a holiday (badge **M**)
- would-be workday with no Workday-calendar event → holiday (badge **H**)

Clicking a day writes or deletes an event in your overrides calendar. Clicking a day that is
already overridden removes the override and returns the day to its natural state.

> **Why a card can do this when a script cannot:** Home Assistant's `calendar` domain exposes
> `create_event` but **no delete service** — deletion exists only as the websocket command
> `calendar/event/delete`, which is unavailable to scripts and automations. A frontend card can
> call it via `hass.callWS`, so toggling works in both directions with no helper scripts,
> shell commands or external bridges.

## Install

### HACS (recommended)

1. HACS → three-dot menu → **Custom repositories**
2. Add `https://github.com/snadboy/ha-workdays-card`, category **Dashboard**
3. Install **Workdays Card**, then reload your browser

### Manual

Copy `workdays-card.js` to `/config/www/` and add a dashboard resource pointing at
`/local/workdays-card.js` (type: JavaScript module). **Add a `?v=` query and bump it on every
edit** — browsers cache the old copy otherwise.

## Prerequisites

- The **Workday** integration, configured for your country.
  Its entity must supply `attributes.workdays`.
- A **Local Calendar** for your overrides (any calendar that supports create *and* delete).

### Feeding Scheduler

Scheduler reads a hardcoded entity id, `binary_sensor.workday_sensor`. Point that name at a
template sensor combining the two, and rename the Workday integration's own sensor out of the
way (e.g. to `binary_sensor.workday_base`):

```jinja
{% set active = is_state('calendar.days_off', 'on') %}
{% set msg = state_attr('calendar.days_off', 'message') %}
{{ (active and msg == 'Workday')
   or (is_state('binary_sensor.workday_base', 'on') and not (active and msg != 'Workday')) }}
```

Scheduler consults that sensor **only for the current day**; for future dates it falls back to
plain Mon–Fri. So a day you tick off still shows its old "next trigger" until that morning,
when the sensor flips and Scheduler recalculates. This is the same behaviour holidays have
always had.

## Configuration

```yaml
type: custom:workdays-card
overrides_calendar: calendar.days_off                      # required
workday_calendar: calendar.workday_sensor_us_calendar      # default shown
workday_sensor: binary_sensor.workday_base                 # default shown
title: Workdays
settings_path: /config/integrations/integration/workday
```

| Option | Default | Description |
|---|---|---|
| `overrides_calendar` | — | **Required.** Calendar storing your overrides. Must support create and delete. |
| `workday_calendar` | `calendar.workday_sensor_us_calendar` | Per-date workday source from the Workday integration. |
| `workday_sensor` | `binary_sensor.workday_base` | Supplies `attributes.workdays` for the default week. |
| `title` | `Workdays` | Card heading. |
| `settings_path` | Workday integration page | Where "Holidays & country…" navigates. |

## Settings

The gear opens a modal:

- **Default workdays** — seven chips. Saving drives the Workday integration's own options flow,
  so it is the same write HA's UI performs. A day ticked here is also removed from Workday's
  `excludes` list, otherwise the exclusion would silently win.
- **Holiday source / Your overrides** — shows the calendars in use.
- **Holidays & country…** — opens the full Workday options for country, province,
  `add_holidays` and `remove_holidays`.

## Notes and gotchas

- **Root font-size is 14px in Home Assistant**, not the browser's 16px. `rem` sizes render ~12%
  smaller than you expect; this card uses explicit pixel sizes. `<button>` also does not inherit
  `font-family`, so it is set explicitly — without it, buttons fall back to Arial.
- **After saving settings** the Workday integration reloads and briefly serves an empty
  calendar, during which every day would look like a holiday. The card retries for ~8s.
- **Month fetches span the whole six-week grid** (−10/+16 days). A narrower window makes
  trailing days of the grid appear as false holidays.
- **Navigating months fires overlapping fetches**; a slower response for the month you left is
  discarded rather than overwriting the one you are on.
- The settings dialog is a sibling of `ha-card`, not a child, so grid re-renders (which happen on
  every state update) cannot destroy an edit in progress.

## License

MIT
