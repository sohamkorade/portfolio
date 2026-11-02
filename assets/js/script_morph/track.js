/** Fire a GA4 event when gtag is present; no-op offline / analytics-off. */
export function track(name, params = {}) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
