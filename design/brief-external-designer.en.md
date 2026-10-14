# Horizontal — design brief

## In short

Horizontal is a task and project-planning app for one person who works with a
small team. It has two faces, and they should feel like a single product:

- **the daily list**: what I have to do today, tomorrow and this week, across all
  projects;
- **project planning**: what depends on what, what I can start right now, and
  what we're shipping in the current delivery stage.

## Who uses it and how

- About half the time on a **phone** (Android), half on a **laptop** (browser).
- On the phone it's used on the move:
  - jot down a task fast;
  - tick it off;
  - push it to tomorrow;
  - see what's next;
  - snap a photo of a whiteboard or a receipt and attach it.
- On the laptop it's used at a desk:
  - read and write long descriptions;
  - organise projects;
  - comment and hand a task over to a colleague.
- The main user is a power user, with keyboard shortcuts for everything. Still, a
  client or a colleague seeing it for the first time should understand it and
  like it.

## Why we want a new design

A client said the app "looks like it was made in 1990", "looks like AI made all
of it", and "has no colour, it's bland — you don't enjoy looking at it". We want:

- a **clean, well-organised app with colour and personality**, one you're glad to
  open;
- something credible in front of a client;
- a compact phone layout. Today everything feels too big, and a daily list needs
  to show many rows at a glance.

## The things in the app

- **Task (ticket)**:
  - a title and a short ID (e.g. `HZ-12`);
  - a description with light formatting: headings, lists, inline checkboxes,
    code, links;
  - a "done" checkbox.
- **Due date**:
  - a day, optionally with a time;
  - optionally a reminder, which arrives as a notification;
  - it can repeat: daily, every Monday, on the 15th of each month, etc.
  - The date can be typed straight into the title ("tomorrow at 10"), and the app
    recognises and highlights it.
- **Urgent**: a flag on a task. Urgent tasks come first in a list.
- **Project**:
  - every task belongs to a project;
  - a project has a name, a colour and a prefix used for IDs;
  - **Inbox** is the default project for quick captures;
  - a project can be "reminders only" (routines): its tasks show up in the list
    only once their reminder fires.
- **Attachments**: photos and files on a task, plus "download all".
- **Thread**:
  - comments on a task;
  - handing a task over to a colleague ("it's yours now") happens together with
    a comment, not as a separate step.
- **Google Calendar events**: shown among the tasks at their time. They can't be
  ticked off.

### Project planning only

- **Dependencies**: a task can wait on other tasks. The app works out "what I can
  start now", then "what comes after", as a set of steps.
- **Delivery stages** ("waves"): groups of tasks shipped together. Dependency
  steps and delivery stages are two separate things.
- **Obstacles**: outside conditions that block work (e.g. "waiting for the bank
  to reply"). They have four states:
  - unknown;
  - waiting;
  - cleared;
  - worked around.
- **Themes**: coloured labels on tasks.

## Screens

**On the phone** (a bottom bar with three tabs, plus a side menu):

1. **Today**:
   - overdue tasks first, in red, each showing the day it was missed, with a
     "move all to today" button;
   - then today's tasks: urgent first, then those with a time in order, then
     those without a time;
   - calendar events mixed in at their time;
   - tasks completed today, hidden behind a toggle.
2. **Next 7 days**: the same, grouped by day.
3. **Mine**: tasks someone handed over to me, with unread ones kept separate.
4. **Side menu**:
   - who I am and the settings;
   - pinned shortcuts;
   - lists and saved filters;
   - projects, each with its count of open tasks.
5. **Quick capture**: a floating button opens a sheet attached to the keyboard.
   - On the sheet: title, optional description, date and time, project,
     attachment.
   - You type and send it in a few seconds.
6. **Task sheet**: opens from the bottom, for quick reading and editing:
   - checkbox, title, date and time, project, attachments, description;
   - it saves on its own, with no save button;
   - one button opens the full form.
7. **Full form**: everything above, plus:
   - dependencies;
   - delivery stage;
   - assignee;
   - recurrence;
   - the comment thread.
8. **Project**:
   - a list grouped by steps;
   - a board with cards in columns by step ("Order");
   - a dependency map;
   - themes.
9. **Search**: across all tasks; open ones by default, closed ones optional.
10. **Settings**: light or dark theme, background, text size (four steps).

**On the laptop**:

- A permanent sidebar instead of the side menu.
- The list on the left and the open task in a panel on the right, like a mail
  client.
- A task can also be opened large, over the list, for long descriptions.
- Quick capture is a row above the list.

## Key gestures and interactions

- On the phone, a task row can be swiped:
  - right: move to tomorrow;
  - left: date, time, delete, more.
- Long-pressing a row starts multi-select, for acting on several tasks at once.
- Deleting doesn't ask for confirmation. An "Undo" message shows for a few
  seconds instead.
- On the laptop, the keyboard does everything: search, new task, navigation.
- It also works **offline**: what you write is sent once the signal is back. The
  interface quietly shows "N waiting".

## Where else the app lives

- **Notifications** with buttons ("Done", "Snooze").
- **Android widget**:
  - a 7-day agenda with checkboxes;
  - a quick-capture button.
- **Linux capture bar**: a single line, opened with a keyboard shortcut.

These should share the same visual language, but they're secondary.

## What we want and what we don't

**We want**:

- colour used with meaning: projects have real colours, and status reads at a
  glance (overdue, urgent, today, done);
- a clear hierarchy and a dense but airy list;
- both a light and a dark theme, equally polished;
- icons, not emoji;
- room for Romanian, which runs longer than English ("Mută restanțele pe azi" =
  "Move overdue to today");
- text that can be enlarged from settings without breaking the screens.

**We don't want**:

- an "AI-generated" look: purple gradients, neon on black, glass everywhere, a
  border around every box;
- a document or newspaper look;
- oversized elements that leave only 5–6 rows on a phone screen.

## What would help us to receive

1. A visual direction: colours, typography, icons, corner radii, shadows.
2. The priority screens:
   - **Today on the phone**;
   - **the task sheet on the phone**;
   - **quick capture**;
   - **the list with the side panel on the laptop**;
   - **the side menu**.
3. If there's time, further:
   - the full form;
   - the project board;
   - the dependency map;
   - the widget.
4. Each screen in both themes and in a few states:
   - empty list;
   - overdue tasks;
   - multi-select;
   - an open swipe.
