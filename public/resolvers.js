// Broadcasters that publish their current live manifest from their own player
// endpoint instead of a stable URL we can bake into the catalogue.
//
// Lives in public/ so the browser and the API route share one definition, the
// same arrangement public/channels.js uses. The page resolves for itself and
// /api/resolve is only the fallback, because these endpoints answer per region:
// asked from Vercel's Frankfurt region tvopen.gr returns its "out of Greece"
// placeholder on s.tvopen.gr, while the viewer's own browser gets the channel.
//
// `hosts` is the whole security model. A resolver may only hand back a URL on a
// host it declares up front, so a regional placeholder - or a compromised
// upstream - cannot be played as if it were the channel. Keep every host listed
// here also covered by a stream URL in the catalogue, so the relay will carry it
// (see ALLOWED_HOSTS in api/stream.js).

export const RESOLVERS = {
  // Open Beyond. iptv-org carries other channels on Open's CDN but not this one;
  // tvopen.gr's embed player (/OpenTVLive) reads this JSON and plays `stream`.
  7: {
    name: "Open Beyond",
    endpoint: "https://www.tvopen.gr/templates/data/LiveDetails",
    hosts: ["liveopen.siliconweb.com"],
    pick: (data) => data.stream || data.lowstream || null,
  },
};

/**
 * The URL a resolver returned, or null when we won't play it. Shared so the
 * page and the API route can never disagree about what is acceptable.
 * @returns {string|null}
 */
export function acceptableUrl(raw, resolver) {
  if (typeof raw !== "string" || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!resolver.hosts.includes(url.host.toLowerCase())) return null;
  return url.href;
}
