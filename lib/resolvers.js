// The resolver table lives in public/ so the browser can import it directly as a
// static asset and the API route can import the very same file, exactly as
// lib/channels.js does for the catalogue.

export * from "../public/resolvers.js";
