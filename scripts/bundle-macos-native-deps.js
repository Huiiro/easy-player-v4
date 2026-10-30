/* eslint-disable @typescript-eslint/no-require-imports -- Native packaging runner. */
const path = require('node:path')
if (process.platform === 'darwin') {
  const root = path.resolve(__dirname, '..')
  require('./macos-runtime.cjs').bundleMacosRuntime(
    root,
    path.resolve(root, process.argv[2] || 'build/native-addon'),
    process.env.EASY_PLAYER_NATIVE_ARCH || process.arch
  )
}
