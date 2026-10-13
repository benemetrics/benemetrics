---
name: Obsidian Telemetry
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#bcc9cd'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#869397'
  outline-variant: '#3d494c'
  surface-tint: '#4cd7f6'
  primary: '#4cd7f6'
  on-primary: '#003640'
  primary-container: '#06b6d4'
  on-primary-container: '#00424f'
  inverse-primary: '#00687a'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#c0c1ff'
  on-tertiary: '#1000a9'
  tertiary-container: '#9a9dff'
  on-tertiary-container: '#211cb4'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#acedff'
  primary-fixed-dim: '#4cd7f6'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
  label-code-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-code-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 15px
  label-code-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 13px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-tablet: 1rem
  margin: 1rem
  margin-tablet: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system is engineered for developers, site reliability engineers, and engineering leads who need immediate, friction-free triage of production exceptions and performance regressions on mobile. The aesthetic balances precision tooling with a modern terminal-inspired atmosphere: hyper-focused, quiet, and razor-sharp.

The style fuses **Developer-First Minimalism** with **Tactical Telemetry Accents**. Rather than overwhelming the user with decorative chrome, the interface relies on deep obsidian backgrounds, high-contrast monospace code blocks, and laser-precise signals. Emerald and cyan indicators telegraph operational health and runtime throughput, while deep violet and indigo tints reinforce an observability context. The interface feels responsive, authoritative, and mission-critical.

## Colors

The palette operates in default `dark` mode, tailored for low-light debugging and rapid scanning:

- **Primary (`#06B6D4` - Cyber Cyan):** Represents active telemetry, live traces, and primary navigational interactive states.
- **Secondary (`#10B981` - Emerald Health):** Communicates operational stability, resolved issues, 2xx runtime responses, and healthy uptime metrics.
- **Tertiary (`#6366F1` - Electric Indigo):** Denotes performance spans, latency distributions, and secondary telemetry metadata.
- **Neutral (`#0B0F17` - Obsidian Base):** Deep, low-noise foundation designed to eliminate OLED glare while establishing high contrast against code traces and status tags.

### Functional Roles & Accents
- **Critical / Error (`#F43F5E`):** Unhandled exceptions, 5xx server errors, and performance regression breaches.
- **Warning / Degraded (`#F59E0B`):** Handled errors, slow transactions, and memory warnings.
- **Surfaces:** Layered using subtle luminance steps (`#0B0F17` base, `#131926` elevated surface, `#1E2638` interactive/border surface).

## Typography

Typography is split into two distinct functional disciplines:
1. **Interface & Structural Text (Inter):** Clean, geometric, and neutral. Used for screen titles, metrics navigation, metadata summaries, and structural content.
2. **Telemetry & Code (JetBrains Mono):** Monospaced precision for stack traces, exception classes (`NullPointerException`, `SIGSEGV`), transaction durations (`142ms`), and HTTP status codes (`500`).

Monospaced styles (`label-code-*`) feature tabular figures by default to keep latency charts, timestamps, and log listings aligned in high-density mobile views.

## Layout & Spacing

The layout is built for maximum information density without visual crowding. It employs a **fluid grid** optimized for compact handheld viewports:

- **Mobile Viewports (<600px):** Single-column stack with `margin: 1rem` and `gutter: 0.75rem`. Content elements snap directly to the 4px baseline rhythm.
- **Tablet / Large Handhelds (≥600px):** Two-column split-pane master-detail view with `margin-tablet: 1.5rem` and `gutter-tablet: 1rem`, displaying issue feeds alongside stack frame details.
- **Rhythm:** Internal component spacing defaults to `space-sm` (8px) for tightly packed data rows and `space-md` (12px) for card interiors. Stack traces and raw JSON payloads collapse margins to preserve vertical code scanning speed.

## Elevation & Depth

Visual hierarchy is achieved through **tonal layering and low-contrast borders** rather than conventional heavy drop shadows.

- **Base Canvas (`#0B0F17`):** The ground level for the application window and background scroll area.
- **Surface Level 1 (`#131926`):** Applied to telemetry cards, exception list items, and filter sheets. Contoured with a 1px border (`rgba(255, 255, 255, 0.08)`).
- **Surface Level 2 (`#1B2334`):** Sub-elements like individual stack frames, breadcrumb pill containers, and input fields.
- **Telemetry Glow (Accents):** Transient elevations (e.g., active incident alerts, unresolved critical errors) emit a subtle ambient radial glow (`0px 0px 12px rgba(6, 182, 212, 0.15)` or `0px 0px 12px rgba(244, 63, 94, 0.20)`). Drop shadows are otherwise absent to keep the terminal atmosphere sharp and utilitarian.

## Shapes

The design system maintains a **compact, technical radius** (`roundedness: 1`):

- **Default Elements (Buttons, Inputs, Cells):** `0.25rem` (4px). Reflects an architectural, developer-centric environment.
- **Cards, Modals & Code Panels (`rounded-lg`):** `0.5rem` (8px). Softens boundaries just enough to differentiate layered telemetry from the background canvas.
- **Status Badges & Telemetry Indicators (`rounded-xl`):** `0.75rem` (12px) or full capsule pill shapes for status tags (e.g., `RESOLVED`, `P99`, `v1.4.2`).

## Components

### Buttons
- **Primary:** High-contrast `#06B6D4` fill with `#0B0F17` text. Bold, monospace label styling, 36px height for compact touch density.
- **Secondary / Ghost:** Transparent background with a `1px solid rgba(255, 255, 255, 0.12)` border and `#E2E8F0` text.
- **Destructive:** `#F43F5E` outline or muted red background tint (`rgba(244, 63, 94, 0.12)`) for resolving/deleting production incidents.

### Status Pills & Chips
- **Status Indicators:** Micro badges (height: 20px) featuring a solid circular status dot (6px) accompanied by monospaced status copy (`label-code-sm`).
- **Telemetry Chips:** Cyan/Emerald/Indigo border-tinted capsules displaying transaction tags (e.g., `release:prod-8f2e`, `env:production`, `p95: 184ms`).

### Exception & Performance Cards
- Encased in Surface Level 1 with 1px border stroke.
- Features top-bar telemetry header: timestamp, event count, and user impact count formatted in JetBrains Mono.
- Headline displays the error title (e.g., `TypeMismatchError`) in Inter semi-bold, followed by the culprit file location in muted monospaced text.

### Monospace Stack Traces & Breadcrumbs
- Inverted frame view: System libraries muted (`#64748B`), application code highlighted in `#F8FAFC` against `#1B2334`.
- Breadcrumb steps organized as a vertical railway timeline connected with 1px hairline cyan or emerald lines.

### Inputs & Filters
- Compact 36px height with dark charcoal fill (`#131926`), 1px structural border, and monospaced search syntax (e.g., `is:unresolved level:error`). Focus states display a `#06B6D4` border stroke without outer ring bleed.

### Telemetry Sparklines & Micro Charts
- Minimalist vector charts showing 24-hour error frequency and latency curves.
- Zero grid line clutter; smooth 1.5px stroke width in Emerald (`#10B981`) or Cyan (`#06B6D4`) with a fading vertical gradient mask down to 0% opacity.