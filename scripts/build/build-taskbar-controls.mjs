import { spawnSync } from 'node:child_process'
if (process.platform !== 'win32') process.exit(0)
for (const args of [
  [
    '-S',
    'engine-windows/taskbar-controls',
    '-B',
    'build/taskbar-controls',
    '-A',
    process.arch === 'arm64' ? 'ARM64' : 'x64'
  ],
  ['--build', 'build/taskbar-controls', '--config', 'Release']
]) {
  const result = spawnSync('cmake', args, { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
