import { Component, Inject, Injectable } from '@angular/core'
import { LogService } from 'tabby-core'
import type { Logger } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { FKNAT_TRANSLATION_SERVICE, FKNATTranslator } from '../i18n'
import { BillingService } from '../services/billing.service'
import { HelperService } from '../services/helper.service'

@Component({
    selector: 'fknat-settings-tab',
    template: `
        <h3 translate>FKNAT Network</h3>
        <p *ngIf="configured" class="text-success" translate>Billing authorization: Ready</p>
        <p *ngIf="!configured" class="text-warning" translate>FKNAT billing key is not configured.</p>
        <input #billingInput type="file" accept="application/json,.json" hidden (change)="importBilling(billingInput)">
        <button class="btn btn-primary" type="button" (click)="billingInput.click()">
            {{ (configured ? 'Replace billing key' : 'Import billing key') | translate }}
        </button>
        <button class="btn btn-secondary ml-2" type="button" (click)="runDoctor()" [disabled]="busy" translate>Run diagnostics</button>
        <p *ngIf="message" class="mt-3">{{ message }}</p>
        <small class="text-muted" translate>The private key is stored locally and is not included in SSH profiles.</small>
    `,
})
export class FKNATSettingsTabComponent {
    configured = false
    busy = false
    message = ''
    private readonly log: Logger

    constructor (
        @Inject(BillingService) private readonly billingService: BillingService,
        @Inject(HelperService) private readonly helper: HelperService,
        @Inject(FKNAT_TRANSLATION_SERVICE) private readonly i18n: FKNATTranslator,
        @Inject(LogService) logService: LogService,
    ) {
        this.log = logService.create('tabby-fknat.settings')
        this.log.debug('FKNAT settings component constructed')
        void this.refresh().catch(error => {
            this.log.error('FKNAT settings refresh failed', { error: describeError(error) })
            this.message = this.i18n.instant('FKNAT diagnostics failed.')
        })
    }

    async refresh (): Promise<void> {
        this.log.debug('Refreshing FKNAT settings state')
        this.configured = await this.billingService.isConfigured()
        this.log.info('FKNAT settings state refreshed', { configured: this.configured })
    }

    async importBilling (input: HTMLInputElement): Promise<void> {
        const file = input.files?.[0]
        if (!file) return
        this.busy = true
        this.message = ''
        this.log.info('Importing FKNAT billing key', { size: file.size, name: file.name })
        try {
            const destination = await this.billingService.importFromBytes(new Uint8Array(await file.arrayBuffer()))
            this.message = this.i18n.instant('Billing key imported.')
            this.log.info('FKNAT billing key imported', { destination, size: file.size })
            await this.refresh()
        } catch (error) {
            this.log.error('FKNAT billing key import failed', { error: describeError(error) })
            this.message = this.i18n.instant(error instanceof Error ? error.message : 'Billing key import failed.')
        } finally {
            this.busy = false
            input.value = ''
        }
    }

    async runDoctor (): Promise<void> {
        this.busy = true
        this.message = ''
        this.log.info('FKNAT settings diagnostics requested')
        try {
            const result = await this.helper.doctor()
            this.log.info('FKNAT settings diagnostics completed', result)
            this.message = result.ok
                ? this.i18n.instant('FKNAT network: {status}', {
                    status: result.network_status ?? this.i18n.instant('ready'),
                })
                : this.i18n.instant('FKNAT diagnostics failed.')
        } catch (error) {
            this.log.error('FKNAT settings diagnostics failed', { error: describeError(error) })
            this.message = this.i18n.instant(error instanceof Error ? error.message : 'FKNAT diagnostics failed.')
        } finally {
            this.busy = false
        }
    }
}

function describeError (error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

@Injectable()
export class FKNATSettingsTabProvider extends SettingsTabProvider {
    id = 'fknat'
    icon = 'fas fa-network-wired'
    title = 'FKNAT'
    weight = 20
    prioritized = false

    getComponentType (): any {
        return FKNATSettingsTabComponent
    }
}
