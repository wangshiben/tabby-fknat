import { Inject, NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { ConfigProvider, ConfigService, LogService, ProfileProvider } from 'tabby-core'
import TabbySettingsModule, { SettingsTabProvider } from 'tabby-settings'
import TabbyTerminalModule from 'tabby-terminal'
import { FKNATProfileSettingsComponent } from './components/fknatProfileSettings.component'
import { FKNATSettingsTabComponent, FKNATSettingsTabProvider } from './components/fknatSettingsTab.component'
import { FKNAT_TRANSLATION_SERVICE } from './i18n'
import { defaultFKNATConfig } from './models/config'
import { FKNATProfileProvider } from './providers/fknatProfile.provider'
import { BillingService } from './services/billing.service'
import { HelperService } from './services/helper.service'
import { FKNATTranslationService } from './services/i18n.service'
import { FKNATPlatformService } from './services/platform.service'

declare const __FKNAT_PLUGIN_VERSION__: string

class FKNATConfigProvider extends ConfigProvider {
    defaults = { fknat: defaultFKNATConfig }
    platformDefaults = {}
}

@NgModule({
    imports: [CommonModule, FormsModule, TabbyCoreModule, TabbySettingsModule, TabbyTerminalModule],
    providers: [
        FKNATPlatformService,
        BillingService,
        FKNATTranslationService,
        { provide: FKNAT_TRANSLATION_SERVICE, useExisting: FKNATTranslationService },
        {
            provide: HelperService,
            useFactory: (
                platform: FKNATPlatformService,
                config: ConfigService,
                translations: FKNATTranslationService,
                log: LogService,
            ) => new HelperService(platform, config, translations, log.create('tabby-fknat.helper')),
            deps: [FKNATPlatformService, ConfigService, FKNAT_TRANSLATION_SERVICE, LogService],
        },
        { provide: ConfigProvider, useClass: FKNATConfigProvider, multi: true },
        { provide: ProfileProvider, useExisting: FKNATProfileProvider, multi: true },
        { provide: FKNATProfileProvider, useClass: FKNATProfileProvider },
        { provide: SettingsTabProvider, useClass: FKNATSettingsTabProvider, multi: true },
    ],
    declarations: [FKNATProfileSettingsComponent, FKNATSettingsTabComponent],
})
export default class FKNATModule {
    constructor (
        @Inject(FKNATTranslationService) readonly translations: FKNATTranslationService,
        @Inject(LogService) logService: LogService,
    ) {
        logService.create('tabby-fknat.module').info('FKNAT Tabby plugin module loaded', {
            pluginVersion: __FKNAT_PLUGIN_VERSION__,
            moduleDirectory: __dirname,
            platform: process.platform,
            arch: process.arch,
        })
    }
}
