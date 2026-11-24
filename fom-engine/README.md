# FOM Engine

One small local server on your Mac for the FOM dashboard's Mac tools. Free, no API keys, your photos stay on the Mac.

- **Photo Cull** (dashboard page `cull.html`): Aftershoot-style culling, starter edits and learning, then Lightroom.
- **FOM Video** slot (`modules/video.js`): the FOM Video project plugs its editor in here, so only one engine ever runs.

## Install (once)

1. Unzip and move the **FOM Engine** folder to your home folder (`/Users/you/FOM Engine`). Not the Desktop: it syncs to iCloud.
2. Open Terminal, drag `setup.sh` in, press Enter. First time takes 5 to 10 minutes (Python tools and models).
3. It prints a self test and starts the engine at every login. Open **Photo Cull** in the dashboard in Chrome. If Chrome asks about apps and devices on this computer, press Allow.

Run `setup.sh` again after any update. `start.command` runs the engine in a Terminal window instead.

## How a cull works

| Step | What happens |
|---|---|
| Previews | The JPEG inside every CR3 / DNG is pulled out (no full RAW decode). JPEG and HEIC open directly. |
| Measure | Focus where it matters (faces, or the sharpest part for cars and sport), exposure, white balance, horizon, faces, eye blink and smile (MediaPipe), who is who (SFace), similar shots and looks (CLIP + LAION beauty score). |
| Group | Shots close in time that look alike become one group (bursts). |
| Choose | Per job type weights. Best of each group is a keeper, the rest duplicates. Blur, closed eyes and misfires are rejects. Then it hits your keep rate and marks the top 5 to 10% as highlights. |
| Claude | Only the close calls and highlight candidates, as a few contact sheets, through Claude Code on your Pro plan. |
| Learn | Your final picks (and your edits, when exported as Original + Settings) slowly take over the choosing. |

## What Lightroom gets

| Cull | Lightroom |
|---|---|
| Highlight | Pick flag, 5 stars |
| Keeper | Pick flag, 3 stars |
| Check me | 2 stars, Red |
| Duplicate | 1 star, Yellow |
| Reject | Reject flag |

Plus keywords `cull:keeper`, `cull:blurry`, `cull:person-p1`, `cull:group-12` (search them in Lightroom).

- CR3 and other RAW: `IMG_1234.xmp` next to the file. The RAW is never changed.
- JPEG, HEIC, ProRAW DNG: inside the file (Lightroom ignores sidecars for these). Only the metadata, never the pixels; the old metadata is saved in the shoot folder's `.fomcull/backup` first.
- **Reset** on the page deletes the sidecars it made and puts the old metadata back exactly.

## Folders

```
FOM Engine/
  server.js          the engine (127.0.0.1:7788)
  modules/           cull.js, video.js
  cull/              the cull in Python
  models/            face, eye and look models (setup.sh)
  presets/fom, sba   your Lightroom presets for starter edits
  learn/             what it learned from your picks and edits (back this up)
  cache/             previews per shoot, cleared after 14 days
  data/              engine log, recent folders
<shoot folder>/.fomcull/   the cull, your hand changes, metadata backups
```

## First test (do this before a client job)

Cull a small folder with one CR3, one JPEG, one HEIC, one ProRAW DNG and one tilted shot. Write it with Basic edits, import into Lightroom and check: stars, pick and reject flags, colour labels, keywords, exposure, and that the tilted photo straightens the right way. If straighten goes the wrong way, set `ANGLE_SIGN = -1.0` in `cull/edits.py`.

## If something is off

- Page says the engine is not running: double-click `start.command`, or check `data/engine.log`.
- Cannot open a folder on an external drive or the Desktop: System Settings, Privacy and Security, Files and Folders (or Full Disk Access), allow **node**.
- Claude does not judge: install Claude Code (`npm install -g @anthropic-ai/claude-code`) and run `claude` once to sign in.
- Stop the engine: `launchctl bootout gui/$(id -u)/za.co.fomstudios.engine`
