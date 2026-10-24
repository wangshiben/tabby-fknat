import { Inject, Injectable, OnDestroy } from '@angular/core'
import { LocaleService, TranslateService } from 'tabby-core'
import { Subscription } from 'rxjs'
import { FKNAT_TRANSLATIONS, FKNATTranslator } from '../i18n'

@Injectable()
export class FKNATTranslationService implements FKNATTranslator, OnDestroy {
    private readonly localeSubscription: Subscription

    constructor (
        @Inject(LocaleService) private readonly locale: LocaleService,
        @Inject(TranslateService) private readonly translate: TranslateService,
    ) {
        this.localeSubscription = this.locale.localeChanged$.subscribe(language => this.install(language))

        const language = this.locale.getLocale()
        if (this.translate.getLangs().includes(language)) {
            this.install(language)
        }
    }

    instant (key: string, params?: Record<string, unknown>): string {
        return this.translate.instant(key, params)
    }

    ngOnDestroy (): void {
        this.localeSubscription.unsubscribe()
    }

    private install (language: string): void {
        const translations = FKNAT_TRANSLATIONS[language]
        if (translations) {
            this.translate.setTranslation(language, translations, true)
        }
    }
}
