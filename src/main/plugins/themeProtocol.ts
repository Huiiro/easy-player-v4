const resourceMime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2'
}
type ThemeResourceReader = (id: string, hash: string, path: string) => Uint8Array | undefined

/** Serve only resources approved by the active installed theme's package manager. */
export function themeResourceResponse(url: URL, read: ThemeResourceReader): Response {
  try {
    const [, id, hash, ...parts] = url.pathname.split('/')
    const bytes = read(id, hash, parts.join('/'))
    if (bytes)
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type':
            resourceMime[parts.join('/').split('.').at(-1)?.toLowerCase() ?? ''] ??
            'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      })
  } catch {
    /* Unavailable, disabled and undeclared resources all remain inaccessible. */
  }
  return new Response('Not Found', { status: 404 })
}
