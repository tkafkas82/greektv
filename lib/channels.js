// Single source of truth for the catalogue lives in public/ so the browser can
// import it directly as a static asset and the API routes can import the very
// same file. Keeping one copy means the grid and the guide can never disagree
// about which channels exist.

export * from "../public/channels.js";