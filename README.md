# World Empires

A 3D globe you can spin to see **which empires, kingdoms and peoples held which parts of the world**, from 123,000 BC to 2010.

## What it does

- **Ask for a time period.** Type a year (`500 BC`, `AD 100`, `1492`), a century (`5th century BC`, `12th century`), a span of years (`1400s`), or an empire (`Roman Empire`, `Mongols`, `Persia`, `China`). The globe switches to the map closest to that date and tells you if it had to round to the nearest one.
- **Search by empire.** Choosing an empire jumps to the map where it is **largest** and flies the globe to it.
- **Click any territory or name** to see what it is, which provinces or vassals it included, its rough size in km², which maps it appears on, and a "Read more" link.
- **Timeline.** Drag the slider, use ‹ › or the arrow keys, or press ▶ to watch borders change over time.
- **States, nations, peoples and archaeological cultures.** Organized states and empires are drawn in solid color. From 1492 on, Indigenous nations and confederacies of the Americas (e.g. the Haudenosaunee, Cherokee, Cree) have their own label and are also drawn in solid color. Peoples (ethnic, language or tribal groups, e.g. Scythians) and archaeological cultures (groups named for their pottery or tools, e.g. Funnel-Beaker, Olmec) are drawn faintly, and a checkbox hides them. Names the source uses for a region before any state existed there (e.g. Egypt in 4000 BC) are shown as a culture or people until the state's founding date, with a note.
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

- The source's 1492 map of the Americas was built from a present-day map of Indigenous territories. The data step removes entries that did not exist in 1492 (lands of nations removed to Oklahoma in the 1830s, modern reservations and rancherias, groups that formed after contact) and renames modern governments to the nation they represent (`DROP_1492` and `RENAME_1492` in `scripts/prepare-data.mjs`). Each removed area was checked to be covered by a correct 1492 nation. Some territories still reflect later movements (e.g. the Kickapoo area is very large).
- Names on the globe itself are shown in plain letters (the 3D label font has no accents or non-Latin scripts); the side panel and info cards show the full name.

- Borders are approximate. Ancient frontiers were usually zones of influence, not lines.
- Clear-cut duplicate names are merged, but successor states are deliberately kept separate (e.g. Roman Republic vs. Roman Empire, Russian Empire vs. USSR vs. Russia).
- Every name that appears before 1492 was classified by hand as a state, people or archaeological culture (`KIND_LIST` and `BECAME_STATE` in `scripts/prepare-data.mjs`). Later names fall back to keyword rules, so a few may still be in the wrong group.

## Licenses

- Border data: GPL-3.0 (`data/LICENSE-historical-basemaps.txt`)
- Globe library [globe.gl](https://github.com/vasturiano/globe.gl): MIT (`assets/vendor/globe.gl.LICENSE`)
- Earth imagery from [three-globe](https://github.com/vasturiano/three-globe) examples (`assets/LICENSE-three-globe-images.txt`)
