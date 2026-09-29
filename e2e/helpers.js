/**
 * Blocks the app's external network calls (Google Analytics, Google
 * Fonts) so e2e runs are fast, deterministic, and don't depend on the
 * test environment's egress policy. Neither is required for the app to
 * function: gtag.js silently no-ops when it fails to load, and the
 * Poppins/Outfit font import just falls back to the next font in the
 * stack.
 */
export async function blockExternal(page) {
  await page.route("**://www.googletagmanager.com/**", (route) =>
    route.abort()
  );
  await page.route("**://fonts.googleapis.com/**", (route) => route.abort());
}
