import assert from 'node:assert/strict'
import * as path from 'node:path'
import test from 'node:test'
import { bundledHelperPath, currentHelperPlatform } from './platform.service'

test('selects all supported helper platform directories', () => {
    assert.equal(currentHelperPlatform('win32', 'x64'), 'win32-x64')
    assert.equal(currentHelperPlatform('linux', 'arm64'), 'linux-arm64')
    assert.equal(currentHelperPlatform('darwin', 'x64'), 'darwin-x64')
})

test('rejects unsupported helper platforms', () => {
    assert.throws(() => currentHelperPlatform('freebsd', 'x64'))
    assert.throws(() => currentHelperPlatform('win32', 'ia32'))
})

test('locates bin from both bundled dist and source module directories', () => {
    assert.equal(
        bundledHelperPath('/plugin/dist', 'linux', 'x64'),
        path.join('/plugin', 'bin', 'linux-x64', 'fknat-tabby-helper'),
    )
    assert.equal(
        bundledHelperPath('/plugin/src/services', 'win32', 'arm64'),
        path.resolve('/plugin', 'bin', 'win32-arm64', 'fknat-tabby-helper.exe'),
    )
})
