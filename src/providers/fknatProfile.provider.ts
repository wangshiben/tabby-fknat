import { Inject, Injectable, Injector } from '@angular/core'
import { BaseTabComponent, LogService, NewTabParameters, PartialProfile, ProfilesService, QuickConnectProfileProvider } from 'tabby-core'
import type { Logger } from 'tabby-core'
import { FKNATProfileSettingsComponent } from '../components/fknatProfileSettings.component'
import { FKNAT_TRANSLATION_SERVICE, FKNATTranslator } from '../i18n'
import { FKNATSSHProfile, parseFKNATQuickConnect, toNativeSSHProfile } from '../models/profile'
import { HelperService } from '../services/helper.service'

@Injectable({ providedIn: 'root' })
export class FKNATProfileProvider extends QuickConnectProfileProvider<FKNATSSHProfile> {
    private readonly log: Logger
    id = 'fknat-ssh'
    name = 'FKNAT SSH'
    settingsComponent = FKNATProfileSettingsComponent
    configDefaults = {
        options: {
            address: '',
            port: 22,
            user: 'root',
            auth: null,
            password: null,
            privateKeys: [],
            agentForward: false,
            forwardedPorts: [],
            fknatProfileVersion: 1,
        },
        clearServiceMessagesOnConnect: true,
    }

    constructor (
        @Inject(HelperService) private readonly helper: HelperService,
        @Inject(FKNAT_TRANSLATION_SERVICE) private readonly i18n: FKNATTranslator,
        @Inject(LogService) logService: LogService,
        @Inject(Injector) private readonly injector: Injector,
    ) {
        super()
        this.log = logService.create('tabby-fknat.profile')
        this.log.debug('FKNAT profile provider constructed')
    }

    async getBuiltinProfiles (): Promise<PartialProfile<FKNATSSHProfile>[]> {
        return [{
            id: 'fknat-ssh:template',
            type: this.id,
            name: this.i18n.instant('FKNAT SSH connection'),
            icon: 'fas fa-network-wired',
            isBuiltin: true,
            isTemplate: true,
            weight: -1,
            options: { address: '', port: 22, user: 'root', auth: null, privateKeys: [], fknatProfileVersion: 1 },
        }]
    }

    async getNewTabParameters (profile: FKNATSSHProfile): Promise<NewTabParameters<BaseTabComponent>> {
        this.log.info('Preparing FKNAT SSH tab', {
            address: redactAddress(profile.options.address),
            user: profile.options.user || 'root',
            port: profile.options.port,
            auth: profile.options.auth ?? 'automatic',
            configuredPrivateKeyCount: profile.options.privateKeys?.length ?? 0,
            privateKeySource: !profile.options.auth || profile.options.auth === 'publicKey'
                ? (profile.options.privateKeys?.length ? 'configured' : 'automatic discovery')
                : 'disabled by authentication mode',
        })
        await this.helper.assertExecutable()
        const version = await this.helper.version()
        this.log.debug('FKNAT helper protocol checked', version)
        if (version.protocol_version !== 1) {
            throw new Error(this.i18n.instant('Unsupported FKNAT helper protocol version {version}', {
                version: version.protocol_version,
            }))
        }
        const nativeProfile = toNativeSSHProfile(profile, this.helper.buildProxyCommand(profile.options.address))
        // Resolve lazily: ProfilesService itself injects all profile providers.
        // Delegate to the registered SSH provider so its component and key locators
        // use the same Angular tokens, even if npm installed another tabby-ssh copy.
        const profiles = this.injector.get(ProfilesService)
        const sshProvider = profiles.providerForProfile(nativeProfile)
        if (!sshProvider) {
            this.log.error('Tabby native SSH profile provider is unavailable')
            throw new Error(this.i18n.instant('The native Tabby SSH plugin is not available. Enable it and restart Tabby.'))
        }
        const parameters = await sshProvider.getNewTabParameters(profiles.getConfigProxyForProfile(nativeProfile))
        this.log.info('FKNAT SSH tab parameters ready', {
            address: redactAddress(profile.options.address),
            helperVersion: version.helper_version,
            protocolVersion: version.protocol_version,
            sshProvider: sshProvider.constructor.name,
            sshComponent: parameters.type.name,
            auth: nativeProfile.options.auth ?? 'automatic',
            configuredPrivateKeyCount: nativeProfile.options.privateKeys?.length ?? 0,
        })
        return parameters
    }

    getSuggestedName (profile: PartialProfile<FKNATSSHProfile>): string {
        return `${profile.options?.user || 'root'}@${profile.options?.address || 'FKNAT'}`
    }

    getDescription (profile: PartialProfile<FKNATSSHProfile>): string {
        return profile.options?.address ?? ''
    }

    quickConnect (query: string): PartialProfile<FKNATSSHProfile> | null {
        return parseFKNATQuickConnect(query)
    }

    intoQuickConnectString (profile: FKNATSSHProfile): string | null {
        const user = profile.options.user || 'root'
        return `fknat://${user}@${profile.options.address}`
    }
}

function redactAddress (address: string | undefined): string {
    if (!address) return '<empty>'
    return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-8)}`
}
