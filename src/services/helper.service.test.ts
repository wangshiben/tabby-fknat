import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { HelperService } from './helper.service'

const i18n = {
    instant: (message: string, params?: Record<string, unknown>) => Object.entries(params ?? {}).reduce(
        (result, [key, value]) => result.replace(`{${key}}`, String(value)),
        message,
    ),
} as any

test('builds a proxy command with a fixed route contract', () => {
    const service = new HelperService(
        { getHelperPath: () => '/tmp/FKNAT helper', getDataDirectory: () => '/tmp' } as any,
        { store: { fknat: {} } } as any,
        i18n,
    )
    const command = service.buildProxyCommand('ab'.repeat(32), 'posix')
    assert.equal(command, "'/tmp/FKNAT helper' 'connect' '--config-dir' '/tmp' '--server-id' 'abababababababababababababababababababababababababababababababab' '--timeout' '30s'")
    assert.equal(command.includes('--route'), false)
})

test('passes the plugin data directory through the Windows proxy command', () => {
    const service = new HelperService(
        { getHelperPath: () => 'C:\\Users\\ADMIN\\AppData\\Roaming\\tabby-fknat\\bin\\helper.exe', getDataDirectory: () => 'C:\\Users\\ADMIN\\AppData\\Roaming\\tabby-fknat' } as any,
        { store: { fknat: {} } } as any,
        i18n,
    )
    const command = service.buildProxyCommand('ab'.repeat(32), 'win32')
    assert.match(command, /--config-dir.*tabby-fknat/)
    assert.match(command, /--server-id/)
    assert.match(command, /--timeout.*30s/)
})

test('accepts an executable helper override without a package manifest', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fknat-helper-'))
    const helperPath = path.join(directory, 'helper')
    await fs.writeFile(helperPath, '#!/bin/sh\n', { mode: 0o700 })
    const service = new HelperService(
        { getHelperPath: () => helperPath } as any,
        { store: { fknat: { helperPathOverride: helperPath } } } as any,
        i18n,
    )
    await service.assertExecutable()
    await fs.rm(directory, { recursive: true, force: true })
})
