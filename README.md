# Domain Blocker

A Firefox extension that blocks access to specified domains on configurable schedules. Supports full blocks during time windows and time-limited access (e.g., 30 minutes of social media per day during work hours).

## Features

- **Domain groups** — organise blocked sites into named, colour-coded groups
- **Schedule-based blocking** — define days and time windows for when blocks apply
- **Full block** — completely block access during scheduled windows
- **Time-limited access** — allow a set number of minutes per window before blocking
- **Subdomain matching** — blocking `youtube.com` also blocks `www.youtube.com`, `m.youtube.com`, etc.

## Installation

### From source (development)

1. Clone the repository
2. Run `npm install`
3. Load as a temporary extension in Firefox:
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from the project root

### Building

```bash
npm run build        # creates distributable .zip in dist/
npm run lint         # runs web-ext lint
```

## Usage

1. Click the toolbar icon to see active blocks and toggle blocking on/off
2. Open **Settings** to create block groups:
   - Name the group and pick a colour
   - Add domains (one per line)
   - Add one or more schedules with days, time window, and block type
3. Save — blocking takes effect immediately

## License

GPL-3.0
