import * as main from '../src/main'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import * as io from '@actions/io'
import * as tc from '@actions/tool-cache'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'

const toolDir = path.join(
  __dirname,
  'runner',
  path.join(Math.random().toString(36).substring(7)),
  'tools'
)
const tempDir = path.join(
  __dirname,
  'runner',
  path.join(Math.random().toString(36).substring(7)),
  'temp'
)

process.env['RUNNER_TOOL_CACHE'] = toolDir
process.env['RUNNER_TEMP'] = tempDir

describe('setup-edgedb', () => {
  let inputs = {} as any
  let inSpy: jest.SpyInstance
  let inBooleanSpy: jest.SpyInstance
  let cnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let dbgSpy: jest.SpyInstance
  let warningSpy: jest.SpyInstance
  let dlSpy: jest.SpyInstance
  let findSpy: jest.SpyInstance
  let cacheSpy: jest.SpyInstance
  let execSpy: jest.SpyInstance

  beforeEach(() => {
    // @actions/core
    console.log('::stop-commands::stoptoken')
    process.env['GITHUB_PATH'] = ''
    inputs = {
      'project-link': false
    }
    inSpy = jest.spyOn(core, 'getInput')
    inSpy.mockImplementation(name => inputs[name] || '')
    inBooleanSpy = jest.spyOn(core, 'getBooleanInput')
    inBooleanSpy.mockImplementation(name => inputs[name])

    // @actions/tool-cache
    dlSpy = jest.spyOn(tc, 'downloadTool')
    findSpy = jest.spyOn(tc, 'find')
    cacheSpy = jest.spyOn(tc, 'cacheFile')

    // @actions/exec
    execSpy = jest.spyOn(exec, 'exec')

    // writes
    cnSpy = jest.spyOn(process.stdout, 'write')
    logSpy = jest.spyOn(core, 'info')
    dbgSpy = jest.spyOn(core, 'debug')
    warningSpy = jest.spyOn(core, 'warning')
    cnSpy.mockImplementation(line => {
      // uncomment to debug
      process.stderr.write('write:' + line + '\n')
    })
    logSpy.mockImplementation(line => {
      // uncomment to debug
      process.stderr.write('log:' + line + '\n')
    })
    dbgSpy.mockImplementation(msg => {
      // uncomment to see debug output
      process.stderr.write(msg + '\n')
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  it('Installs CLI', async () => {
    let versionSpec = '1.0.0-alpha.7'
    let resolvedVersion = versionSpec

    inputs['cli-version'] = '>=1.0.0-alpha.5 <=1.0.0-alpha.7'

    const baseDist = main.getBaseDist(os.arch(), os.platform())
    const pkgBase = `https://packages.edgedb.com/archive/${baseDist}`
    const expectedUrl = pkgBase + '/edgedb-cli_1.0.0-alpha.7_2020121617'

    const tmpdir = fs.mkdtempSync('edgedb-setup')
    let tmp = path.join(tmpdir, 'foo')
    fs.closeSync(fs.openSync(tmp, 'w'))
    tmp = fs.realpathSync(tmp)

    dlSpy.mockImplementation(async () => tmp)

    findSpy.mockImplementation(() => '')

    const cliPath = path.normalize('/cache/edgedb/1.0.0-alpha.7')
    cacheSpy.mockImplementation(async () => cliPath)

    await main.run()

    fs.unlinkSync(tmp)
    fs.rmdirSync(tmpdir)

    expect(dlSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      `Downloading edgedb-cli ${resolvedVersion} - ${os.arch} from ${expectedUrl}`
    )
    expect(cnSpy).toHaveBeenCalledWith(`::add-path::${cliPath}${os.EOL}`)
  })

  it('Installs server', async () => {
    let versionSpec = '1.0.0-alpha.7'
    let resolvedVersion = versionSpec

    inputs['cli-version'] = '>=1.0.0-alpha.5 <=1.0.0-alpha.7'
    inputs['server-version'] = 'stable'

    const baseDist = main.getBaseDist(os.arch(), os.platform())
    const pkgBase = `https://packages.edgedb.com/archive/${baseDist}`
    const expectedUrl = pkgBase + '/edgedb-cli_1.0.0-alpha.7_2020121617'

    const tmpdir = fs.mkdtempSync('edgedb-setup')
    let tmp = path.join(tmpdir, 'foo')
    fs.closeSync(fs.openSync(tmp, 'w'))
    tmp = fs.realpathSync(tmp)

    dlSpy.mockImplementation(async () => tmp)

    findSpy.mockImplementation(() => '')

    execSpy.mockImplementation(async (cmd, args, opts: ExecOptions) => {
      if (args[0] === 'server' && args[1] === 'install') {
        return 0
      } else if (
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

    const cliPath = path.normalize('/cache/edgedb/1.0.0-alpha.7')
    cacheSpy.mockImplementation(async () => cliPath)
    const serverPath = path.dirname(tmp)

    await main.run()

    fs.unlinkSync(tmp)
    fs.rmdirSync(tmpdir)

    expect(dlSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      `Downloading edgedb-cli ${resolvedVersion} - ${os.arch} from ${expectedUrl}`
    )
    expect(cnSpy).toHaveBeenCalledWith(`::add-path::${serverPath}${os.EOL}`)
    expect(cnSpy).toHaveBeenCalledWith(`::add-path::${cliPath}${os.EOL}`)
  })
})
