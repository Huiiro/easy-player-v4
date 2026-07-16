import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          /\.node$/, // Native addons
          'koffi', // FFI alternative
          'better-sqlite3'
        ]
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [
      vue(),
      tailwindcss(),
      createSvgIconsPlugin({
        iconDirs: [path.resolve(process.cwd(), 'src/renderer/src/assets/svg')],
        symbolId: 'icon-[dir]-[name]'
      })
    ]
  }
})
