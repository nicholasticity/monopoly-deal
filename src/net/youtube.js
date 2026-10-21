// YouTube links, for the room's music: the video's id from any of the usual forms
// (youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…, music.youtube.com), or null.
// Shared by the browser (to check a link) and the server (which only ever stores ids).
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);

export function videoId(text) {
  const raw = String(text ?? '').trim();
  if (ID.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const path = url.pathname.split('/').filter(Boolean);
  const id = url.hostname.toLowerCase() === 'youtu.be' ? path[0] : url.searchParams.get('v') ?? (['shorts', 'embed', 'live', 'v'].includes(path[0]) ? path[1] : null);
  return id && ID.test(id) ? id : null;
}

// A playlist's id from a YouTube link that has one (…/playlist?list=…, or a song played
// from a playlist or mix, watch?v=…&list=…), or null.
const LIST = /^[A-Za-z0-9_-]{10,64}$/;
export function playlistId(text) {
  const raw = String(text ?? '').trim();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const list = url.searchParams.get('list');
  return list && LIST.test(list) ? list : null;
}

// Most songs a room's queue holds (the one playing included): room for a playlist.
export const QUEUE_MAX = 100;
