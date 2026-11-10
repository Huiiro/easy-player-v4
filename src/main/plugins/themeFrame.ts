/** Host-owned frame shell; theme archives cannot provide arbitrary HTML. */
export function officialThemeFrame(scriptURL: string): Buffer {
  const resourceURL = new URL(scriptURL)
  resourceURL.pathname =
    resourceURL.pathname.split('/').slice(0, 3).join('/') + '/__glass-snapshot.js'
  const snapshotURL = resourceURL.href
  const policy = [
    "default-src 'none'",
    `script-src ${scriptURL} ${snapshotURL}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob: easy-player-media://plugin-theme',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  return Buffer.from(
    `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body,#app{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}html.theme-paused *,html.theme-paused *::before,html.theme-paused *::after{animation-play-state:paused!important}</style></head><body><div id="app"></div><script src="${snapshotURL}"></script><script src="${scriptURL}"></script></body></html>`
  )
}
