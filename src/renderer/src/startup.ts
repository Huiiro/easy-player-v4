// Keep this entry free of application imports and styles: paint the logo first.
async function start(): Promise<void> {
  const logo = document.querySelector<HTMLImageElement>('#startup-screen img')
  await logo?.decode().catch((error) => console.error('Failed to decode startup logo', error))
  const presented = await window.api.window.startupReady()
  if (presented) {
    document.documentElement.dataset.startupPresented = 'true'
    // Allow the newly shown native window to paint before loading Vue and its styles.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  } else {
    // View replacements and auxiliary windows retain their existing frame until ready.
    document.documentElement.dataset.startupHidden = 'true'
  }
  if (document.documentElement.dataset.playbackView === 'extreme') await import('./extreme')
  else await import('./main')
}

void start()
