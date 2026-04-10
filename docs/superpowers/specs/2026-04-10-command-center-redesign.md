# Command Center UI Redesign

## Problem

The current command center stacks 9 sections above the chat area (provider bar, surface state panel, controls bar, browser intelligence, action composer, active actions, recent actions, tasks). Over half the viewport is consumed before the user sees any conversation content. Most of these panels show decorative status labels rather than actionable information.

## Design

### Layout Structure

```
┌──────────────────── HEADER ─────────────────────────┐
│ ┌────────────────────────────────┐ ┌──────────────┐ │
│ │  BOX 1  │ BOX 2 │ BOX 3 │ BOX4│ │              │ │
│ ├────────────────────────────────┤ │    LOGS      │ │
│ │                                │ │  (full ht)   │ │
│ │            CHAT                │ │              │ │
│ │                                │ │              │ │
│ ├────────────────────────────────┤ │              │ │
│ │         input + send           │ │              │ │
│ └────────────────────────────────┘ └──────────────┘ │
├──────────────────── STATUS BAR ─────────────────────┤
```

- **Header**: full width, thin bar with "COMMAND CENTER" label and active task summary
- **Logs panel**: right column, ~28% width, runs full height from header to status bar
- **Metric boxes**: 4 boxes in a row, spanning only the chat column width (~72%)
- **Chat**: fills remaining vertical space below metric boxes, within the left column
- **Input footer**: text input + send button, pinned to bottom of chat column
- **Status bar**: full width, bottom, shows sync state, split ratio, model info, session ID

### Visual Style

- Monochrome throughout — no accent colors
- Dark background (#0a0a0a), subtle borders (#151515)
- Text hierarchy: #ccc for primary numbers, #555 for labels, #333 for secondary text, #222 for ghost text
- Geist Mono font throughout
- Thin 2px progress bars with #444 fill on #151515 track
- 1px separator gaps between metric boxes (using background color trick)

### Metric Boxes

Four equal-width boxes showing live data from Codex `/status`:

1. **Context Window** — "62% left", "106K used / 258K", progress bar
2. **5h Limit** — "0% left", "resets 15:12", progress bar
3. **Weekly Limit** — "65% left", "resets 12:50 on 16 Apr", progress bar
4. **Credits + Controls** — credit count (e.g. "99"), model selector (Auto/Codex/Haiku), execution split selector (Bal/Brws/Term)

Each box layout:
- Label (7px uppercase, letter-spaced, #333)
- Primary value (15px, #ccc, font-weight 500)
- Secondary text (9px, #333)
- Progress bar (2px height) where applicable

### Logs Panel

- Full height of the viewport (below header, above status bar)
- Header with "LOGS" label and "Clear" button
- Scrolling event stream
- Each entry: timestamp (#222) + source (#555) + message (#333)
- Font size 7.5px, compact line height
- Background slightly darker than main (#080808)

### Chat Area

- Fills remaining space in left column below metric boxes
- User messages: right-aligned, dark background (#111), border, rounded corners
- Model messages: left-aligned, no background, model name label above
- Input footer: text input + send button, border-top separator

### Removed Sections

The following are removed entirely from the UI:
- Provider status bar (provider health moved to status bar or inferred)
- Surface state panel (browser URL/title/tabs, terminal shell/PID)
- Browser Intelligence panel
- Action composer (manual action dispatch)
- Active actions panel
- Recent actions panel
- Tasks panel

### Status Bar

Thin bar at bottom, full width:
- Sync state
- Execution split ratio
- Model name and config (e.g. "gpt-5.4 (reasoning medium)")
- Session ID (truncated)

## Data Source

Codex exposes status via its `/status` slash command which returns:
- Model, directory, permissions, account info
- Context window: percentage left, used/total
- 5h limit: percentage left, reset time
- Weekly limit: percentage left, reset date
- Credits: count remaining

This data needs to be periodically fetched and pushed to the command center renderer.

## Principles

- Only show information that changes how the user works
- Monochrome — add color only when it earns its place
- Metric boxes are the dashboard — everything else is chat + logs
- Layout is modular: boxes can be added/removed/replaced as the product evolves
