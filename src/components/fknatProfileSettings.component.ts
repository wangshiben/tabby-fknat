import { Component, Inject } from '@angular/core'
import { ProfileSettingsComponent } from 'tabby-core'
import { FKNAT_TRANSLATION_SERVICE, FKNATTranslator } from '../i18n'
import { FKNATSSHProfile } from '../models/profile'
import { isFKNATAddress, normalizeFKNATAddress } from '../utils/address'

@Component({
    selector: 'fknat-profile-settings',
    template: `
        <div class="form-group">
            <label translate>FKNAT Address</label>
            <input class="form-control" [(ngModel)]="profile.options.address" [placeholder]="'64-character FKNAT Address' | translate">
            <small class="form-text text-muted" *ngIf="addressError">{{ addressError }}</small>
        </div>
        <div class="form-group">
            <label translate>SSH port</label>
            <input class="form-control" type="number" [(ngModel)]="profile.options.port" min="1" max="65535">
        </div>
        <div class="form-group">
            <label translate>SSH username</label>
            <input class="form-control" [(ngModel)]="profile.options.user" autocomplete="username">
        </div>
        <div class="form-group">
            <label translate>Authentication</label>
            <select class="form-control" [(ngModel)]="profile.options.auth">
                <option [ngValue]="null" translate>Automatic</option>
                <option value="password" translate>Password</option>
                <option value="publicKey" translate>Public key</option>
                <option value="agent" translate>SSH agent</option>
                <option value="keyboardInteractive" translate>Keyboard interactive</option>
            </select>
        </div>
        <small class="form-text text-muted" *ngIf="profile.options.auth === 'password'" translate>
            Tabby will prompt for the SSH password and may save it in its native keychain.
        </small>
        <div class="form-group" *ngIf="profile.options.auth === 'publicKey'">
            <label translate>Private key</label>
            <input class="form-control" [(ngModel)]="privateKey" placeholder="~/.ssh/id_ed25519">
        </div>
        <p class="text-muted" translate>FKNAT route 0 and the helper transport are managed automatically.</p>
    `,
})
export class FKNATProfileSettingsComponent implements ProfileSettingsComponent<FKNATSSHProfile> {
    profile!: FKNATSSHProfile
    addressError = ''

    constructor (@Inject(FKNAT_TRANSLATION_SERVICE) private readonly i18n: FKNATTranslator) {}

    get privateKey (): string {
        return this.profile.options.privateKeys?.[0] ?? ''
    }

    set privateKey (value: string) {
        this.profile.options.privateKeys = value.trim() ? [value.trim()] : []
    }

    save (): void {
        if (!isFKNATAddress(this.profile.options.address)) {
            this.addressError = this.i18n.instant('Address must be exactly 64 hexadecimal characters.')
            return
        }
        this.profile.options.address = normalizeFKNATAddress(this.profile.options.address)
        this.profile.options.port = this.profile.options.port || 22
        this.profile.options.user = this.profile.options.user?.trim() || 'root'
        this.profile.options.fknatProfileVersion = 1
    }
}
