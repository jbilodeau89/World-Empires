# World Empires

A 3D globe you can spin to see **which empires, kingdoms and peoples held which parts of the world**, from 123,000 BC to 2010.

## What it does

- **Ask for a time period.** Type a year (`500 BC`, `AD 100`, `1492`), a century (`5th century BC`, `12th century`), a span of years (`1400s`), or an empire (`Roman Empire`, `Mongols`, `Persia`, `China`). The globe switches to the map closest to that date and tells you if it had to round to the nearest one.
- **Search by empire.** Choosing an empire jumps to the map where it is **largest** and flies the globe to it.
- **Click any territory or name** to see what it is, which provinces or vassals it included, its rough size in km², which maps it appears on, and a "Read more" link.
- **Timeline.** Drag the slider, use ‹ › or the arrow keys, or press ▶ to watch borders change over time.
- **States vs. peoples.** Organized states and empires are drawn in solid color. Peoples and cultures (e.g. "Paleo-Siberian hunter-gatherers") are drawn faintly, and a checkbox hides them.
- **Starting points.** First-time visitors see a few one-click suggestions (Ancient Egypt, Alexander the Great, the Roman Empire at its height, the Mongol conquests, 1492, the eve of World War I).
- **Shareable links.** The web address updates as you go (e.g. `…#year=-323&empire=Empire of Alexander`), so you can bookmark a view or send it to someone.
- Each empire keeps the **same color on every map**, so you can follow it through time.

## Running it

It's a plain website with no build step. On a computer with [Node.js](https://nodejs.org):

```
npm start
```

Then open http://localhost:8080. (If you open `index.html` by double-clicking it, the maps won't load. Browsers block that, so it needs to be served.)

To put it online, upload the folder to any static web host (GitHub Pages, Netlify, Vercel, etc.). Everything it needs, including the globe library and earth imagery, is in this folder.

## Where the maps come from

The borders come from the [historical-basemaps](https://github.com/aourednik/historical-basemaps) project by André Ourednik and contributors (GPL-3.0). It has **53 snapshots**, with gaps that are wider in ancient times (e.g. 2000 BC → 1500 BC → 1000 BC) and narrower in modern times. Each territory is tagged as approximate, moderately precise or precise, and the app shows that tag.

`npm run prepare-data` re-downloads the source and rebuilds everything in `data/`: it simplifies the shapes so the globe stays fast, fixes a few malformed records, merges names the source spells differently for the same state (e.g. "Han" / "Han Empire", "UK" / "United Kingdom"; see `SAME_AS` in `scripts/prepare-data.mjs`), and builds the search index.

### Known limitations

- Borders are approximate. Ancient frontiers were usually zones of influence, not lines.
- Clear-cut duplicate names are merged, but successor states are deliberately kept separate (e.g. Roman Republic vs. Roman Empire, Russian Empire vs. USSR vs. Russia).
- Whether an area counts as a "state" or a "people/culture" is decided by keyword rules (in `scripts/prepare-data.mjs`), so a few entries may be in the wrong group.

## Licenses

- Border data: GPL-3.0 (`data/LICENSE-historical-basemaps.txt`)
- Globe library [globe.gl](https://github.com/vasturiano/globe.gl): MIT (`assets/vendor/globe.gl.LICENSE`)
- Earth imagery from [three-globe](https://github.com/vasturiano/three-globe) examples (`assets/LICENSE-three-globe-images.txt`)
