# gradescope-calendar-sync

Chrome extension that syncs Gradescope assignment deadlines to your calendar. Automatically detects assignments and creates calendar events.

## Features
- Automatic assignment detection
- Calendar integration
- Background sync

## Installation
1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this folder

## Development
```bash
npm install
```

## Files
- `manifest.json` - Extension configuration
- `background.js` - Background service worker
- `content.js` - Page content script
- `popup.js` - Extension popup

## License
MIT
