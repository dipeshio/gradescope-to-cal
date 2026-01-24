# gradescope-calendar-sync

Chrome extension that reads Gradescope assignments and creates calendar entries.

## Structure
- manifest.json – extension manifest
- background.js, content.js, calendar*.js – scraping and sync logic
- assets/ – icons
- package.json – dev dependencies
- config.template.js – example config values

## Install (development)
```bash
npm install
```
Load the folder as an unpacked extension via chrome://extensions (Developer Mode). If you customize code, rebuild assets as needed, then reload the unpacked extension.

## License
MIT