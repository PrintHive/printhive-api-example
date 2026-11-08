// Test clients exercise the same session handshake as the browser.
export async function localFetch(url, options) {
  const target = new URL(url);
  const session = await fetch(new URL('/session', target));
  const { token } = await session.json();
  const headers = new Headers(options?.headers);
  headers.set('x-printhive-session', token);
  return fetch(url, { ...options, headers });
}
