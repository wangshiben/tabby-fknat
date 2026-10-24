import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { BillingService } from './billing.service'

test('imports billing JSON atomically and reports only its path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fknat-tabby-'))
    const billing = new BillingService({ getBillingPath: () => path.join(root, 'secrets', 'billing.json') } as any)
    const destination = await billing.importFromBytes(new TextEncoder().encode('{"key":"redacted-test-fixture"}'))
    assert.equal(destination, path.join(root, 'secrets', 'billing.json'))
    assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), { key: 'redacted-test-fixture' })
    if (process.platform !== 'win32') {
        assert.equal((await fs.stat(destination)).mode & 0o777, 0o600)
        assert.equal((await fs.stat(path.dirname(destination))).mode & 0o777, 0o700)
    }
    await fs.rm(root, { recursive: true, force: true })
})
