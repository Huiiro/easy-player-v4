/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
if (process.platform !== 'win32') process.exit(0)
const cp = require('node:child_process')
const path = require('node:path')
const assert = require('node:assert/strict')
const child = cp.spawn(
  path.resolve('build/taskbar-controls/bin/Release/easy_player_taskbar.exe'),
  ['--probe'],
  { windowsHide: true, stdio: 'pipe' }
)
let output = '',
  count = 0
const timer = setTimeout(() => {
  console.error('Native taskbar probe timeout:', output)
  child.kill()
  process.exitCode = 1
}, 10000)
const send = (playing, available) =>
  child.stdin.write(
    [
      'S',
      +playing,
      +available,
      1,
      ...[
        '上一首',
        '播放',
        '暂停',
        '下一首',
        playing ? '春|めく & A 😀' : '暂未播放',
        playing ? 'Hana Hope' : '',
        playing ? '专辑' : ''
      ].map((label) => Buffer.from(label).toString('hex') || '-')
    ].join('|') + '\n'
  )
child.stdout.on('data', (chunk) => {
  output += chunk
  let end
  while ((end = output.indexOf('\n')) >= 0) {
    const line = output.slice(0, end).trim()
    output = output.slice(end + 1)
    if (!line.startsWith('layout|')) continue
    const p = line.split('|').slice(1).map(Number)
    try {
      assert.ok(
        p[0] >= p[4] && p[1] >= p[5] && p[2] <= p[6] && p[3] <= p[7],
        'strip is inside actual Windows taskbar'
      )
      assert.ok(p[2] > p[0] && p[3] > p[1])
      assert.equal(p[12], 1, 'strip must be an independent window above the composited taskbar')
      if (p[8]) assert.ok(p[2] <= p[8] || p[3] <= p[9], 'strip stays beside notification area')
      if (count === 0) {
        assert.equal(p[10], 1)
        assert.equal(p[11], 1)
        assert.equal(
          p[13],
          '春|めく & A 😀\nHana Hope\n专辑'.length,
          'native metadata preserves Unicode and separators'
        )
        assert.ok(p[14] > 0, 'horizontal taskbar reserves space for song information')
        count++
        send(false, false)
      } else {
        assert.equal(p[10], 0)
        assert.equal(p[11], 0)
        assert.equal(p[13], '暂未播放'.length, 'metadata clears when playback is empty')
        console.log(
          'Native taskbar probe passed: independent strip aligned with Windows taskbar beside tray; Chinese labels accepted; state enables/disables controls'
        )
        clearTimeout(timer)
        child.stdin.end()
      }
    } catch (error) {
      console.error(error)
      clearTimeout(timer)
      child.kill()
      process.exitCode = 1
    }
  }
})
child.on('close', (code) => {
  clearTimeout(timer)
  if (code !== 0 || count === 0) process.exitCode = 1
  else console.log('Native taskbar helper exited cleanly after host pipe closed')
})
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
  clearTimeout(timer)
})
send(true, true)
