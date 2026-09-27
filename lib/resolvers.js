// Broadcasters that publish their current live manifest from their own player
// endpoint instead of a stable URL we can bake into the catalogue.
//
// The URL in public/channels.js is the fallback: it is what plays when the
// endpoint is unreachable or returns something we don't trust. /api/resolve
// asks the broadcaster what it is serving right now and prefers that.
//
// `hosts` is the whole security model here. A resolver may only hand back a URL
// on a host it declares up front, so an upstream that changes shape - or is
// compromised - cannot point playback at an arbitrary origin. Keep every host
// listed here also reachable by the relay, i.e. covered by a stream URL in the
// catalogue (see ALLOWED_HOSTS in api/stream.js).
//
// Keys must stay in step with RESOLVED_IDS in public/channels.js.

export const RESOLVERS = {
  // Open Beyond. iptv-org carries other channels on Open's CDN but not this one;
  // tvopen.gr's embed player (/OpenTVLive) reads this JSON and plays `stream`.
  7: {
    name: "Open Beyond",
    endpoint: "https://www.tvopen.gr/templates/data/LiveDetails",
    referer: "https://www.tvopen.gr/OpenTVLive",
    hosts: ["liveopen.siliconweb.com"],
    pick: (data) => data.stream || data.lowstream || null,
  },
};
