# Workdays Card

A month grid of **workday checkboxes** for Home Assistant. Tick a day to make it a workday,
untick it to make it a day off. Each day says *why* it is not a workday: the **holiday's name** in orange, or
**Override** in blue for your own changes.

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

- **`Day off`** event → not a workday (labelled **Override**)
- **`Workday`** event → a workday even if it is a holiday (labelled **Override**)
- would-be workday with no Workday-calendar event → holiday (labelled with its name)

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
| `holiday_calendar` | *(none)* | Optional. Supplies holiday **names** for the labels; without it a holiday just reads "Holiday". |
| `reference_calendar` | *(none)* | Optional. A **second** Workday integration entry with no `remove_holidays`. Lets Settings list every public holiday — including ones you have opted to work — so they can be switched back on. |
| `title` | `Workdays` | Card heading. |
| `settings_path` | Workday integration page | Where "Holidays & country…" navigates. |

## Settings

The gear opens a modal:

- **Default workdays** — seven chips. Saving drives the Workday integration's own options flow,
  so it is the same write HA's UI performs. A day ticked here is also removed from Workday's
  `excludes` list, otherwise the exclusion would silently win.
- **Holiday source / Your overrides** — shows the calendars in use.
- **Holidays you take off** — every public holiday in the next 12 months, with a checkbox.
  Untick one you work (Columbus Day is the usual case) and it is written to the Workday
  integration's `remove_holidays`. That matches **by name**, so it applies every year — no
  per-date override needed, and the day disappears from the holiday list everywhere.
- **Holidays & country…** — opens the full Workday options for country, province and
  `add_holidays`.

### Names vs dates

`remove_holidays` accepts a holiday **name** or a **date**, and a name applies every year. But
Workday validates names against the `holidays` python library, whose spellings differ from those
on a typical holiday calendar — *Washington's Birthday* rather than "Presidents' Day",
*Juneteenth National Independence Day* rather than "Juneteenth". A name it does not recognise is
rejected outright with `remove_holiday_error`.

The card therefore submits names first and, if Workday rejects them, falls back to explicit dates.
Dates always validate, but they only cover the occurrences the card can see (the next 12 months),
so those holidays need re-ticking next year. A name that *is* recognised — "Columbus Day" is —
applies indefinitely.

### Why a reference calendar is needed

Home Assistant does **not** expose a config entry's stored options to the frontend — neither
`config_entries/get` nor `config_entries/get_single` returns them, and the Workday options flow
does not prefill `remove_holidays` either (it always offers an empty list, even when removals are
stored). A card therefore cannot read which holidays you have already removed.

The workaround is a second Workday entry with **no** removals, pointed at by `reference_calendar`.
Comparing the two calendars makes the state observable: a date the reference calls a holiday but
the working sensor calls a workday is one you have chosen to work. Without it the card can still
*remove* holidays, but cannot list or restore ones already removed.

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
- **Each day is a `<button>` with `pointer-events: none` on its children.** Without that, the day
  number, checkbox and label each swallow clicks and only thin strips of the cell respond — the
  card looks broken in a way that is easy to blame on the toggle logic.
- **Centring inside a cell uses a flex-grow wrapper, not auto margins.** With a column `gap` and
  padding in play, `margin: auto` does not split the leftover height evenly — the label ended up
  6px below the checkbox and 11px above the bottom edge.

## Developing this card

Edit `workdays-card.js`, then ship it as a release — that is the whole loop:

```bash
git commit -am "..." && git push
gh release create v1.0.7 workdays-card.js --title "v1.0.7" --notes "..."
```

Then in HACS: **Update information** on the card, and install the new version. The
`?hacstag=` in the resource URL changes with each version, so caches invalidate on their own —
there is no `?v=` to bump.

### ⚠️ Do not edit the installed copy in place

HACS writes **two** files into `/config/www/community/ha-workdays-card/`:

```
workdays-card.js
workdays-card.js.gz     <-- Home Assistant serves this one
```

Home Assistant's static handler prefers the pre-compressed `.gz` for any browser that advertises
gzip, which is all of them. Overwriting only the `.js` therefore changes **nothing you can see**:
the browser keeps getting the old bytes, a hard refresh does not help, and neither does a fresh
browser profile, because the staleness is server-side. It is a genuinely confusing failure — edits
appear to do nothing at all.

If you must patch the live copy for a quick test, write both:

```bash
cat workdays-card.js | ssh <ha> "sudo tee /config/www/community/ha-workdays-card/workdays-card.js >/dev/null"
gzip -9 -c workdays-card.js | ssh <ha> "sudo tee /config/www/community/ha-workdays-card/workdays-card.js.gz >/dev/null"
```

Cutting a release is the safer path: HACS rewrites both files and bumps the cache tag.

## License

MIT
