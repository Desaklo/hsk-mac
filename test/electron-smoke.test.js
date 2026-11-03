import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the desktop window loads HSK 1, grades a card, and builds a quiz', { skip: !process.env.DISPLAY, timeout: 60_000 }, async () => {
  const electron = require('electron')
  const child = spawn(electron, ['.', '--no-sandbox', '--disable-gpu'], {
    cwd: root,
    env: { ...process.env, HSK_SMOKE: '1' },
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const code = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`electron timeout\n${output}`))
    }, 45_000)
    child.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolvePromise(exitCode)
    })
  })
  assert.equal(code, 0, output)
  const line = output.split('\n').find((item) => item.includes('HSK_SMOKE_RESULT'))
  assert.ok(line, output)
  const result = JSON.parse(line.slice(line.indexOf('{')))
  assert.equal(result.first, '爱')
  assert.equal(result.revealed, true)
  assert.match(result.meaning, /love/)
  assert.equal(result.hardHanzi, '爱')
  assert.match(result.total, /300/)
  assert.match(result.feedback, /Верно|Неверно/)
})
