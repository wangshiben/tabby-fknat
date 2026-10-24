import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const archive = process.argv[2]
assert.ok(archive, 'Usage: npm run verify:package -- path/to/tabby-fknat-VERSION.tgz')
assert.ok(process.env.npm_execpath, 'Run this check through npm run verify:package')
const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'tabby-fknat-market-install-'))
try {
    await writeFile(join(directory, 'package.json'), '{}\n')
    console.log('Installing the release archive with default npm peer resolution and lifecycle scripts enabled')
    // Tabby's marketplace uses Arborist with save:false. In particular, do not
    // hide packaging errors with --legacy-peer-deps or --ignore-scripts here.
    execFileSync(process.execPath, [process.env.npm_execpath, 'install', resolve(archive),
        '--save=false', '--no-audit', '--no-fund', '--legacy-peer-deps=false', '--ignore-scripts=false',
        '--registry=https://registry.npmjs.org/'], {
        cwd: directory,
        stdio: 'inherit',
        timeout: 180_000,
        windowsHide: true,
    })
    const modules = join(directory, 'node_modules')
    const installed = JSON.parse(await readFile(join(modules, source.name, 'package.json'), 'utf8'))
    assert.equal(installed.version, source.version)
    for (const name of Object.keys(installed.peerDependencies)) {
        assert.equal(installed.peerDependenciesMeta?.[name]?.optional, true,
            `${name} must be supplied by Tabby rather than auto-installed by npm`)
    }
    assert.deepEqual((await readdir(modules)).filter(name => !name.startsWith('.')).sort(), [source.name],
        'A marketplace install must not download another copy of Tabby or Angular')
    const manifest = JSON.parse(await readFile(join(modules, source.name, 'bin', 'manifest.json'), 'utf8'))
    assert.equal(Object.keys(manifest).length, 6)
    for (const [platform, checksum] of Object.entries(manifest)) {
        const filename = `fknat-tabby-helper${platform.startsWith('win32-') ? '.exe' : ''}`
        const binary = await readFile(join(modules, source.name, 'bin', platform, filename))
        assert.equal(`sha256:${createHash('sha256').update(binary).digest('hex')}`, checksum, platform)
    }
    console.log(`Verified ${installed.name}@${installed.version}: no duplicate host dependencies, all six helper checksums valid`)
} finally {
    await rm(directory, { recursive: true, force: true })
}
