import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Inject, Injectable } from '@angular/core'
import { FKNATPlatformService } from './platform.service'

const MAX_BILLING_KEY_BYTES = 64 * 1024

@Injectable({ providedIn: 'root' })
export class BillingService {
    constructor (@Inject(FKNATPlatformService) private readonly platform: FKNATPlatformService) {}

    getPath (): string {
        return this.platform.getBillingPath()
    }

    async isConfigured (): Promise<boolean> {
        try {
            const stat = await fs.stat(this.getPath())
            return stat.isFile() && stat.size > 0 && stat.size <= MAX_BILLING_KEY_BYTES
        } catch {
            return false
        }
    }

    async importFromBytes (payload: Uint8Array): Promise<string> {
        if (payload.length === 0 || payload.length > MAX_BILLING_KEY_BYTES) {
            throw new Error('Billing key file must be between 1 and 65536 bytes')
        }
        const text = new TextDecoder().decode(payload)
        let parsed: unknown
        try {
            parsed = JSON.parse(text)
        } catch {
            throw new Error('Billing key file must contain valid JSON')
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Billing key JSON must be an object')
        }
        const destination = this.getPath()
        const directory = path.dirname(destination)
        await fs.mkdir(directory, { recursive: true, mode: 0o700 })
        if (process.platform !== 'win32') {
            await fs.chmod(path.dirname(directory), 0o700)
            await fs.chmod(directory, 0o700)
        }
        const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
        try {
            await fs.writeFile(temporary, payload, { mode: 0o600, flag: 'wx' })
            if (process.platform !== 'win32') {
                await fs.chmod(temporary, 0o600)
            }
            await fs.rename(temporary, destination)
            if (process.platform !== 'win32') {
                await fs.chmod(destination, 0o600)
            }
        } catch (error) {
            await fs.rm(temporary, { force: true }).catch(() => undefined)
            throw error
        }
        return destination
    }

    async remove (): Promise<void> {
        await fs.rm(this.getPath(), { force: true })
    }
}
