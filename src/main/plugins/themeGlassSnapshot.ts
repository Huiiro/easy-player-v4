/** Host-owned helper. Receives only parent requests; never exposes DOM or host APIs. */
export const themeGlassSnapshot = Buffer.from(`(() => {
  let busy = false;
  const output = document.createElement('canvas');
  const ctx = output.getContext('2d');
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.channel !== 'easy-player-theme' || event.data.type !== 'glass-frame') return;
    const port = event.ports[0];
    if (!port) return;
    if (busy) { port.postMessage(null); port.close(); return; }
    busy = true;
    requestAnimationFrame(async () => {
      try {
        const sources = [...document.querySelectorAll('#app canvas')].filter(c => c.width && c.height && c.getClientRects().length).slice(0, 8);
        if (!sources.length) { port.postMessage(null); return; }
        const scale = Math.min(1, 1280 / innerWidth, 900 / innerHeight);
        const width = Math.max(1, Math.round(innerWidth * scale));
        const height = Math.max(1, Math.round(innerHeight * scale));
        if (output.width !== width || output.height !== height) { output.width = width; output.height = height; }
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const source of sources) {
          const rect = source.getBoundingClientRect();
          ctx.globalAlpha = Number(getComputedStyle(source).opacity);
          ctx.drawImage(source, rect.left, rect.top, rect.width, rect.height);
        }
        const bitmap = await createImageBitmap(output);
        port.postMessage(bitmap, [bitmap]);
      } catch { port.postMessage(null); }
      finally { busy = false; port.close(); }
    });
  });
})();`)
