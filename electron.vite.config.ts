import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'
import path from 'path'

// Evaluate once per Vite invocation so the main and renderer bundles share a fixed build ID.
const buildNumber = new Date().toISOString().replace(/\D/g, '').slice(0, 14)

export default defineConfig({
  main: {
    define: {
      __APP_BUILD__: JSON.stringify(buildNumber)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          searchWorker: resolve('src/main/search/searchWorker.ts')
        },
        external: [
          'kuroshiro',
          'kuroshiro-analyzer-kuromoji',
          'kuromoji',
          /\.node$/, // Native addons
          'koffi', // FFI alternative
          'better-sqlite3'
        ]
      }
    }
  },
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          main: resolve('src/renderer/index.html'),
          extreme: resolve('src/renderer/extreme.html')
        }
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_BUILD__: JSON.stringify(buildNumber)
    },
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
