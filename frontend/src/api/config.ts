// Same host the page was served from, so a second device on the LAN (the
// engineer station) talks to the driver laptop, not to its own localhost.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? `http://${window.location.hostname}:8000`
