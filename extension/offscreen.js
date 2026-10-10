// Offscreen document: loads one usage page at a time in an iframe so the content scripts
// (all_frames) can read it without any visible tab or window. Driven by background.js.
let frame = null;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'load') {
    frame?.remove();
    frame = document.createElement('iframe');
    frame.width = 1280; // a desktop-sized viewport so pages render their normal layout
    frame.height = 900;
    frame.src = msg.url;
    document.body.append(frame);
  } else if (msg.type === 'unload') {
    frame?.remove();
    frame = null;
  }
  reply({ ok: true });
  return false;
});
