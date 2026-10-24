import assert from 'node:assert/strict'
import test from 'node:test'
const { parse } = require('shell-quote') as { parse: (command: string) => unknown[] }
import { buildShellCommand, quotePOSIXArgument, quoteWindowsArgument } from './quoting'

test('quotes POSIX spaces, Unicode, and apostrophes', () => {
    assert.equal(quotePOSIXArgument('/tmp/FKNAT helper'), "'/tmp/FKNAT helper'")
    assert.equal(quotePOSIXArgument("/tmp/user's helper"), "'/tmp/user'\"'\"'s helper'")
    assert.equal(buildShellCommand('/路径/helper', ['connect'], 'posix'), "'/路径/helper' 'connect'")
})

test('quotes Windows shell metacharacters and quotes', () => {
    assert.equal(quoteWindowsArgument('C:\\Program Files\\FKNAT & Tools\\helper.exe'), '"C:\\Program Files\\FKNAT & Tools\\helper.exe"')
    assert.equal(quoteWindowsArgument('a"b'), '"a""b"')
})

test('round-trips ProxyCommand through Tabby shell-quote parsing', () => {
    const address = 'ab'.repeat(32)
    const windowsPath = 'C:\\Program Files\\FKNAT & Tools\\fknat-tabby-helper.exe'
    const windowsCommand = buildShellCommand(windowsPath, ['connect', '--server-id', address], 'win32')
    assert.deepEqual(parse(windowsCommand), [windowsPath, 'connect', '--server-id', address])

    const posixPath = "/Users/alice/FKNAT helper's bin/fknat-tabby-helper"
    const posixCommand = buildShellCommand(posixPath, ['connect', '--server-id', address], 'posix')
    assert.deepEqual(parse(posixCommand), [posixPath, 'connect', '--server-id', address])
})
