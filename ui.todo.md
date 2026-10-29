# UI Editable & Button Action Map — All Backend Features Wired

Rules:

- Every text input / content-editable field is editable.
- Every button must have a defined action (open modal, open details screen, navigate, toggle, submit).
- Buttons with no sensible action are removed.
- All screens are wired to real backend API endpoints.

---

## App Shell (Sidebar + Topbar + Mobile Nav)

### Sidebar

| Button                                                                                             | Action                                            | Keep? |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----- |
| Project switcher (caret)                                                                           | Open project switcher menu                        | Yes   |
| Project option (each project from API)                                                             | Switch to that project, reload its apps           | Yes   |
| Create new project                                                                                 | Open inline project name input + Create button    | Yes   |
| Create (inline)                                                                                    | POST `/api/admin/projects`, switch to new project | Yes   |
| Nav item (Overview, Apps, Issues, Performance, Logs, Alerts, Releases, Feature flags, Source maps) | Navigate to that screen; close app setup if open  | Yes   |
| Team                                                                                               | Navigate to Team screen                           | Yes   |
| Settings                                                                                           | Navigate to Settings screen                       | Yes   |
| Documentation                                                                                      | Open external docs URL                            | Yes   |
| Help & support                                                                                     | Open external support URL                         | Yes   |
| User card                                                                                          | Open session panel (admin token input)            | Yes   |
| Save & reconnect (session panel)                                                                   | Save admin token and reload                       | Yes   |

### Topbar

| Button                                 | Action                                                       | Keep? |
| -------------------------------------- | ------------------------------------------------------------ | ----- |
| Project trigger (caret)                | Open project switcher menu                                   | Yes   |
| Application switcher (caret)           | Open application filter menu                                 | Yes   |
| Application option (each app from API) | Filter by that application; "All applications" clears filter | Yes   |
| Search input (⌘K)                      | Focus search; Enter → navigate to Issues                     | Yes   |
| Bell icon                              | Navigate to Alerts                                           | Yes   |
| Create alert                           | Navigate to New Alert                                        | Yes   |

### Mobile Nav

| Button                                                 | Action                  | Keep? |
| ------------------------------------------------------ | ----------------------- | ----- |
| Nav item (Overview, Issues, Performance, Logs, Alerts) | Navigate to that screen | Yes   |
| More                                                   | Open mobile more menu   | Yes   |
| More menu item                                         | Navigate to that screen | Yes   |

---

## Overview (Dashboard)

| Button                           | Action                         | Keep? |
| -------------------------------- | ------------------------------ | ----- |
| Range option (Last 3/14/30 days) | Set time range, close menu     | Yes   |
| Custom range                     | Open custom range inputs       | Yes   |
| Apply range                      | Apply custom range, close menu | Yes   |
| View all issues                  | Navigate to Issues             | Yes   |
| Explore logs                     | Navigate to Logs               | Yes   |
| Investigate (insight banner)     | Navigate to Issue detail       | Yes   |
| Create alert (topbar)            | Navigate to New Alert          | Yes   |

---

## Apps

| Button                                            | Action                                                 | Keep? |
| ------------------------------------------------- | ------------------------------------------------------ | ----- |
| Add application                                   | Open inline create form                                | Yes   |
| Create application (inline)                       | POST `/api/admin/projects/:id/apps`, navigate to setup | Yes   |
| Create project (inline, when no project selected) | POST `/api/admin/projects`, select new project         | Yes   |
| App card (Waiting state)                          | Navigate to Setup for that app                         | Yes   |
| App card (Connected state)                        | Navigate to app details (future)                       | Yes   |
| All apps / Connected / Waiting for data tab       | Filter apps by connection state                        | Yes   |

---

## Issues

| Button    | Action                                  | Keep? |
| --------- | --------------------------------------- | ----- |
| Issue row | Navigate to Issue detail for that issue | Yes   |
| ← Prev    | Go to previous cursor page              | Yes   |
| Next →    | Go to next cursor page                  | Yes   |

---

## Issue Detail

| Button                | Action                                             | Keep? |
| --------------------- | -------------------------------------------------- | ----- |
| ← Back to issues      | Navigate back to Issues                            | Yes   |
| Assign                | Open assign-to-user modal                          | Yes   |
| Resolve issue         | PATCH `/api/admin/issues/:id` with status=resolved | Yes   |
| Event row             | Select that event (update stack trace below)       | Yes   |
| ▶ Watch (replay link) | Open session replay player                         | Yes   |

---

## Performance

| Button           | Action                                  | Keep? |
| ---------------- | --------------------------------------- | ----- |
| Create dashboard | Navigate to dashboard creation (future) | Yes   |

---

## Logs

| Button       | Action                         | Keep? |
| ------------ | ------------------------------ | ----- |
| Run query    | Execute the log search query   | Yes   |
| Explore logs | Navigate to full Logs explorer | Yes   |

---

## Alerts

| Button                    | Action                                                 | Keep? |
| ------------------------- | ------------------------------------------------------ | ----- |
| Alert channels            | Navigate to Alert Channels                             | Yes   |
| Create alert              | Navigate to New Alert                                  | Yes   |
| Pause / Enable (rule row) | PATCH `/api/admin/alerting/rules/:id` toggle isEnabled | Yes   |
| Delete (rule row)         | DELETE `/api/admin/alerting/rules/:id`                 | Yes   |

---

## Alert Channels

| Button                   | Action                                             | Keep? |
| ------------------------ | -------------------------------------------------- | ----- |
| ← Back to alerts         | Navigate back to Alerts                            | Yes   |
| Connect (channel card)   | Open channel configuration for that channel type   | Yes   |
| Configure (channel card) | Navigate to Channel Configuration for that channel | Yes   |
| Edit routing rules       | Open routing rules configuration (future)          | Yes   |

---

## Channel Configuration

| Button                   | Action                                                  | Keep? |
| ------------------------ | ------------------------------------------------------- | ----- |
| ← Back to alert channels | Navigate back to Alert Channels                         | Yes   |
| Cancel                   | Navigate back to Alert Channels                         | Yes   |
| Save changes             | PATCH `/api/admin/alerting/channels/:id`, navigate back | Yes   |
| Send test notification   | POST `/api/admin/alerting/channels/:id/test`            | Yes   |
| Send again               | Re-send test notification                               | Yes   |

---

## New Alert / Alert Builder

| Button                         | Action                                                    | Keep? |
| ------------------------------ | --------------------------------------------------------- | ----- |
| ← Back to alerts               | Navigate back to Alerts                                   | Yes   |
| Back (step > 1)                | Go to previous step                                       | Yes   |
| Cancel (step 1)                | Navigate back to Alerts                                   | Yes   |
| Continue (step < 3)            | Go to next step                                           | Yes   |
| Create alert (step 3)          | POST `/api/admin/alerting/rules`, navigate back to Alerts | Yes   |
| Add condition                  | Add a new targeting rule row                              | Yes   |
| Remove (tag filter / rule row) | Remove that filter or rule                                | Yes   |
| Channel checkbox               | Toggle channel subscription for the rule                  | Yes   |

---

## Feature Flags

| Button                        | Action                                             | Keep? |
| ----------------------------- | -------------------------------------------------- | ----- |
| New flag                      | Navigate to New Feature Flag                       | Yes   |
| Pause / Activate (flag row)   | POST `/api/admin/feature-flags/:id/status`         | Yes   |
| Delete (flag row, draft only) | DELETE `/api/admin/feature-flags/:id` (draft only) | Yes   |

---

## New Feature Flag / Feature Flag Builder

| Button                     | Action                                                            | Keep? |
| -------------------------- | ----------------------------------------------------------------- | ----- |
| ← Back to feature flags    | Navigate back to Feature Flags                                    | Yes   |
| Add condition              | Add a new segment rule row                                        | Yes   |
| Remove rule                | Remove that targeting rule row                                    | Yes   |
| Cancel                     | Navigate back to Feature Flags                                    | Yes   |
| Create flag / Save changes | POST `/api/admin/feature-flags` with project + optional app scope | Yes   |

---

## Source Maps

| Button              | Action                                                 | Keep? |
| ------------------- | ------------------------------------------------------ | ----- |
| Create upload token | POST `/api/admin/source-map-tokens`, show token banner | Yes   |
| Copy token          | Copy token to clipboard, hide banner                   | Yes   |
| Revoke (token row)  | DELETE `/api/admin/source-map-tokens/:id`              | Yes   |

---

## Team

| Button                        | Action                                                     | Keep? |
| ----------------------------- | ---------------------------------------------------------- | ----- |
| Add group rule                | POST `/api/admin/permissions/rules`                        | Yes   |
| Disable / Enable (group rule) | PATCH `/api/admin/permissions/rules/:id` toggle isEnabled  | Yes   |
| Remove (group rule)           | DELETE `/api/admin/permissions/rules/:id`                  | Yes   |
| Add user                      | POST `/api/admin/permissions/grants`                       | Yes   |
| Disable / Enable (user grant) | PATCH `/api/admin/permissions/grants/:id` toggle isEnabled | Yes   |
| Remove (user grant)           | DELETE `/api/admin/permissions/grants/:id`                 | Yes   |

---

## Getting Started (Setup)

| Button                                     | Action                                           | Keep? |
| ------------------------------------------ | ------------------------------------------------ | ----- |
| ← Back to applications                     | Navigate back to Apps                            | Yes   |
| Language item                              | Switch SDK language, reset to step 1             | Yes   |
| Read the docs                              | Open documentation URL                           | Yes   |
| Continue (step 1–2)                        | Advance to next step                             | Yes   |
| Check for event / Send test event (step 3) | POST envelope to ingestion API, poll for receipt | Yes   |

---

## Text Inputs (all editable)

Every text input and content-editable field across all screens is backed by React state with `onChange` handlers:

- Project name input (sidebar inline create)
- Application name + platform select (Apps create form)
- Search input (topbar)
- Admin token input (session panel)
- Alert name, type, metric, operator, threshold, window, severity, notify, repeat interval, auto-resolve (Alert Builder)
- Channel name, type, endpoint URL, secret, webhook URL, bot token, channel, routing key, API key (Channel Configuration)
- Flag name, key, description, project, app, rollout percentage, rule attribute/operator/value/variant (Feature Flag Builder)
- Group name, projects, app prefixes (Team group rule form)
- User identity, label, projects, app prefixes, allow writes (Team user grant form)

---

## Removed Buttons

None — every button on every screen has a defined backend action.

---

## Backend API Coverage

| Backend Feature     | Endpoint                                     | Frontend Screen                          |
| ------------------- | -------------------------------------------- | ---------------------------------------- |
| Projects CRUD       | `/api/admin/projects`                        | Apps, App shell                          |
| Apps CRUD           | `/api/admin/projects/:id/apps`               | Apps                                     |
| Issues list/get     | `/api/admin/issues`                          | DataScreen (Issues)                      |
| Issue resolve       | `PATCH /api/admin/issues/:id`                | Issue Detail                             |
| Releases CRUD       | `/api/admin/releases`                        | DataScreen (Releases)                    |
| Alert channels CRUD | `/api/admin/alerting/channels`               | Alert Channels, Channel Config           |
| Alert rules CRUD    | `/api/admin/alerting/rules`                  | DataScreen (Alerts), Alert Builder       |
| Channel test        | `POST /api/admin/alerting/channels/:id/test` | Channel Config                           |
| Feature flags CRUD  | `/api/admin/feature-flags`                   | DataScreen (Feature flags), Flag Builder |
| Flag status         | `POST /api/admin/feature-flags/:id/status`   | DataScreen (Feature flags)               |
| Source maps         | `/api/admin/source-maps`                     | Source Maps                              |
| Source map tokens   | `/api/admin/source-map-tokens`               | Source Maps                              |
| Permissions rules   | `/api/admin/permissions/rules`               | Team                                     |
| Permissions grants  | `/api/admin/permissions/grants`              | Team                                     |
| Event ingestion     | `POST /api/:projectId/envelope/`             | Getting Started                          |
| Session             | `/api/admin/session`                         | (via workspace context)                  |
