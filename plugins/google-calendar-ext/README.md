# Google Calendar

Your Google calendars read into Zeff's calendars. Every Google calendar (yours, family, birthdays …) shows in the Calendar app and
counts for free slots. Nothing changes in Google.

- **A sync of the Sync menu.** The package brings one flow, `google-calendar.sync`, marked as a sync: it is a step of the Sync menu
  (run it there, see how it last went). By itself it runs every 15 minutes between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading Google (its API, or the automation Chrome) and writing Zeff's calendars is a driver of Zeff's
  kernel. The flow calls it through the action `gcal.sync`, which needs the flow's permission `sync: gcalendar` — you allow it when
  you switch.
- **Your settings stay where they were.** Google's API or the automation Chrome: the Connections page. Which weeks and which Google
  account: the calendar settings. *Add to Google Calendar* on a todo's proposed appointment keeps working.

**Switching:** Plugins → Google Calendar (built-in) → *Switch to the plugin*.
