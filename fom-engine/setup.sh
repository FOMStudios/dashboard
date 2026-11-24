#!/bin/bash
# ============================================================
#  FOM ENGINE setup (Mac, Apple silicon). Run once, and again after an update.
#  Open Terminal, drag this file in, press Enter.
#  Installs: exiftool, Python 3.12 tools, the face, eye and look models,
#  then starts the engine every time you log in.
# ============================================================
set -e
cd "$(dirname "$0")"
ENGINE="$(pwd)"
G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
step(){ echo; echo -e "${G}==> $1${N}"; }
warn(){ echo -e "${Y}$1${N}"; }

case "$ENGINE" in
  "$HOME/Desktop"*|"$HOME/Documents"*) warn "Tip: your Desktop and Documents sync to iCloud. Moving this folder to your home folder ($HOME/FOM Engine) keeps the models and caches off iCloud.";;
esac

step "Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
fi
if ! command -v brew >/dev/null 2>&1; then
  echo -e "${R}Homebrew is missing. Install it from https://brew.sh then run this again.${N}"; exit 1
fi

step "exiftool, Python 3.12 and Node"
brew list exiftool >/dev/null 2>&1 || brew install exiftool
brew list python@3.12 >/dev/null 2>&1 || brew install python@3.12
command -v node >/dev/null 2>&1 || brew install node
PY312="$(brew --prefix python@3.12)/bin/python3.12"

step "Python tools (first time takes a few minutes)"
[ -x .venv/bin/python3 ] || "$PY312" -m venv .venv
.venv/bin/python3 -m pip install -q --upgrade pip
.venv/bin/python3 -m pip install -q numpy pillow pillow-heif imagehash opencv-python-headless mediapipe torch open_clip_torch

step "Models"
mkdir -p models
get(){ # url file
  if [ ! -s "models/$2" ]; then echo "  downloading $2"; curl -fsSL -o "models/$2.part" "$1" && mv "models/$2.part" "models/$2" || warn "  could not download $2 (that check is skipped until it is there)"; else echo "  $2 ok"; fi
}
get "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" face_detection_yunet_2023mar.onnx
get "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx" face_recognition_sface_2021dec.onnx
get "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" face_landmarker.task
get "https://github.com/LAION-AI/aesthetic-predictor/raw/main/sa_0_4_vit_b_32_linear.pth" sa_0_4_vit_b_32_linear.pth
echo "  CLIP (similar shots and looks)"
.venv/bin/python3 -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai', cache_dir='models/clip'); print('  CLIP ok')" || warn "  CLIP did not download; it will try again on the first cull"

step "Self test"
.venv/bin/python3 cull/cull.py selftest | tail -1 | .venv/bin/python3 -c "
import sys, json
r = json.loads(sys.stdin.read()); r.pop('done', None)
for k, v in r.items(): print('  ' + ('OK      ' if v else 'MISSING ') + k + ('' if v in (True, False) else ' ' + str(v)))
"
command -v claude >/dev/null 2>&1 || [ -x "$HOME/.claude/local/claude" ] || warn "  Claude Code not found: culls still work, Claude just won't judge the close calls. Install: npm install -g @anthropic-ai/claude-code, then run claude once to sign in."

step "Start the engine at login"
NODE="$(command -v node)"
PL="$HOME/Library/LaunchAgents/za.co.fomstudios.engine.plist"
mkdir -p "$HOME/Library/LaunchAgents" data
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>za.co.fomstudios.engine</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ENGINE/server.js</string></array>
  <key>WorkingDirectory</key><string>$ENGINE</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ENGINE/data/engine.log</string>
  <key>StandardErrorPath</key><string>$ENGINE/data/engine.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/za.co.fomstudios.engine" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"
sleep 2
if curl -s -H 'X-FOM-Engine: 1' http://127.0.0.1:7788/health | grep -q '"ok":true'; then
  echo -e "${G}FOM Engine is running. Open Photo Cull in your dashboard (Chrome).${N}"
else
  warn "The engine did not answer yet. Check data/engine.log, or double-click start.command."
fi
echo
echo "If the cull cannot open a folder on an external drive or your Desktop:"
echo "System Settings, Privacy and Security, Files and Folders (or Full Disk Access), allow node."
