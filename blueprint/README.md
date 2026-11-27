# Blueprint

A free floor plan and room design app that runs entirely in your browser. No login, no server, no paid services. Your plan is saved in your browser.

## Drawing rooms (Phase 1)

- **Room (R):** drag out a rectangle, or click one corner and type a size like `12' x 10'`.
- **Shape (P):** click each corner for rooms with walls at any angle. Type a length and press Enter to place a corner exactly; add `@angle` for direction (`9'4"@75`).
- **Wall (W):** standalone walls such as half walls and partitions.
- **Split (S):** divide a wall in two, then drag the new corner.
- **Select (V):** drag corners to reshape, drag walls to push them in or out, drag inside a room to move it. Connected walls stay connected.
- Type exact lengths and angles in the right panel. Accepts `12'6"`, `12 6`, `6 1/2"`, `3.5m`, `350cm`. Switch ft·in / metric at the top.
- Snaps to the grid, corners, and walls. Hold **Alt** to turn snapping off, **Shift** to lock to 15° angles.
- Undo / redo: Ctrl+Z / Ctrl+Shift+Z. Pan with Space+drag or the middle mouse button; scroll to zoom.
- On a tablet, Blueprint is view-only (drag to pan, pinch to zoom).

## Running it

Plain website, no build step. With [Node.js](https://nodejs.org): `npm start`, then open http://localhost:8080. Or upload the folder to any static host (Vercel, Netlify, GitHub Pages).
