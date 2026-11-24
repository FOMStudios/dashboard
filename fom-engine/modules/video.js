/* FOM Engine module slot: FOM Video (video.html in the dashboard).

   The FOM Video project builds the video editor engine (FFmpeg, whisper.cpp, yt-dlp,
   HyperFrames, claude -p). Instead of running its own server, it plugs in here so the
   Mac only ever runs one FOM Engine on port 7788.

   To plug it in, the FOM Video project replaces this file with its routes, for example:
     api.post('/video/study', async (req, res) => { ... api.job('study', key, onP => api.python(script, args, onP)) ... });
   Everything in server.js's `api` is available: get, post, json, fail, body, sendFile,
   python (progress lines), job / pub (background jobs the page polls at /jobs?id=),
   pickFolder, pickFiles, readJSON, writeJSON, KEY (for <img>/<video> links: ?k=KEY).
   Its Python or Node code goes in ../video/, next to ../cull/.
*/
'use strict';
module.exports = function (api) {
  api.get('/video/health', (req, res) => api.json(res, { ready: false, msg: 'FOM Video is not plugged in yet. The FOM Video project adds its routes to modules/video.js.' }));
  return { title: 'FOM Video', ready: false };
};
