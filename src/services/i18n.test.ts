import assert from 'node:assert/strict'
import test from 'node:test'
import { FKNAT_TRANSLATIONS } from '../i18n'

test('provides complete Simplified and Traditional Chinese translations', () => {
    const simplified = FKNAT_TRANSLATIONS['zh-CN']
    const traditional = FKNAT_TRANSLATIONS['zh-TW']

    assert.ok(Object.keys(simplified).length > 0)
    assert.deepEqual(Object.keys(traditional).sort(), Object.keys(simplified).sort())
    assert.equal(simplified['Import billing key'], '导入扣费密钥')
    assert.equal(traditional['Import billing key'], '匯入計費金鑰')
})
