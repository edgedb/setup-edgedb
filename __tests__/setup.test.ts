import type * as coreType from '@actions/core'
import type * as execType from '@actions/exec'
import type * as tcType from '@actions/tool-cache'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import * as process from 'process'
import url from 'url'
import type * as mainType from '../src/main'
import type * as packagesType from '../src/packages'
import {SpiedModule, spyOnModule} from './spy-on-module'

const tempDir = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  'runner',
  Math.random().toString(36).substring(7)
)
process.env.RUNNER_TOOL_CACHE = path.join(tempDir, 'tools')
process.env.RUNNER_TEMP = path.join(tempDir, 'temp')

describe('setup-edgedb', () => {
  let inputs: Record<string, string | boolean> = {}
  let core: SpiedModule<typeof coreType>
  let exec: SpiedModule<typeof execType>
  let tc: SpiedModule<typeof tcType>
  let packages: SpiedModule<typeof packagesType>
  let main: typeof mainType

  beforeAll(async () => {
    core = await spyOnModule<typeof coreType>('@actions/core')
    tc = await spyOnModule<typeof tcType>('@actions/tool-cache')
    exec = await spyOnModule<typeof execType>('@actions/exec')
    packages = await spyOnModule<typeof packagesType>('../src/packages')
    // After mocks have been set up
    main = await import('../src/main')
  })

  beforeEach(async () => {
    // eslint-disable-next-line no-console
    console.log('::stop-commands::stoptoken')
    process.env['GITHUB_PATH'] = ''
    inputs = {
      'server-dsn': false
    }

    core.getInput.mockImplementation(name => String(inputs[name] || ''))
    core.getBooleanInput.mockImplementation(name => Boolean(inputs[name]))

    core.info.mockImplementation(line => {
      // uncomment to debug
      process.stderr.write(`log:${line}\n`)
    })
    core.debug.mockImplementation(msg => {
      // uncomment to see debug output
      process.stderr.write(`${msg}\n`)
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  it('Installs CLI', async () => {
    const cliVersionRange = '>=3.2.0 <=3.4.0'
    inputs['cli-version'] = cliVersionRange

    const fakePackage: packagesType.Package = {
      name: 'edgedb-cli',
      version: '3.4.0+160d07d',
      revision: '202309122051',
      architecture: 'x86_64',
      installref: '/cli-3.4',
      downloadUrl: 'https://edgedb.com/cli-3.4'
    }
    packages.getCliPackage.mockResolvedValue(fakePackage)

    const tmpdir = fs.mkdtempSync('edgedb-setup')
    let tmp = path.join(tmpdir, 'foo')
    fs.closeSync(fs.openSync(tmp, 'w'))
    tmp = fs.realpathSync(tmp)

    tc.downloadTool.mockImplementation(async () => tmp)

    tc.find.mockImplementation(() => '')

    const cliPath = path.normalize('/cache/edgedb/3.4.0')
    tc.cacheFile.mockImplementation(async () => cliPath)

    await main.run()

    fs.unlinkSync(tmp)
    fs.rmdirSync(tmpdir)

    expect(packages.getCliPackage).toHaveBeenCalledWith(cliVersionRange)
    expect(tc.downloadTool).toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      `Downloading edgedb-cli ${fakePackage.version} - x86_64 from ${fakePackage.downloadUrl}`
    )
    expect(core.addPath).toHaveBeenCalledWith(cliPath)
  })

  it('Installs server', async () => {
    inputs['server-version'] = 'stable'

    packages.getCliPackage.mockResolvedValue({} as packagesType.Package)

    const cliPath = path.normalize('/cache/edgedb/3.4.0')
    tc.find.mockReturnValue(cliPath)

    const tmpdir = fs.mkdtempSync('edgedb-setup')
    let tmp = path.join(tmpdir, 'foo')
    fs.closeSync(fs.openSync(tmp, 'w'))
    tmp = fs.realpathSync(tmp)

    exec.exec.mockImplementation(async (cmd, args, opts) => {
      if (args && args[0] === 'server' && args[1] === 'install') {
        return 0
      } else if (
        args &&
        args[0] === 'server' &&
        args[1] === 'info' &&
        args[2] === '--bin-path'
      ) {
        if (opts?.listeners?.stdout) {
          opts.listeners.stdout(Buffer.from(tmp))
        }
        return 0
      } else {
        return 1
      }
    })

    const serverPath = path.dirname(tmp)

    await main.run()

    fs.unlinkSync(tmp)
    fs.rmdirSync(tmpdir)

    expect(core.addPath).toHaveBeenCalledWith(serverPath)
    expect(core.addPath).toHaveBeenCalledWith(cliPath)
  })
})
