import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as fetch from 'node-fetch'
import * as semver from 'semver'

import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import * as tc from '@actions/tool-cache'

const EDGEDB_PKG_ROOT = 'https://packages.edgedb.com'
const EDGEDB_PKG_IDX = `${EDGEDB_PKG_ROOT}/archive/.jsonindexes`

export async function run(): Promise<void> {
  try {
    const cliPath = await installCLI()
    const serverPath = await installServer(cliPath)
    core.addPath(serverPath)
    core.addPath(cliPath)
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function installServer(cliPath: string): Promise<string> {
  const requestedVersion = core.getInput('server-version')
  const options: ExecOptions = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const cmdline = ['--method', 'package']
  const cli = path.join(cliPath, 'edgedb')

  if (requestedVersion === 'nightly') {
    cmdline.push('--nightly')
  } else if (requestedVersion !== '' && requestedVersion !== 'stable') {
    cmdline.push('--version')
    cmdline.push(requestedVersion)
  }

  await exec.exec(cli, ['server', 'install'].concat(cmdline), options)

  let serverBinPath = ''

  const infoOptions: ExecOptions = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        serverBinPath = data.toString().trim()
      }
    }
  }

  await exec.exec(
    cli,
    ['server', 'info', '--bin-path'].concat(cmdline),
    infoOptions
  )

  serverBinPath = fs.realpathSync(serverBinPath)
  return path.dirname(serverBinPath)
}

async function installCLI(): Promise<string> {
  const arch = os.arch()
  let distArch = ''
  const platform = os.platform()

  if (platform !== 'linux') {
    throw Error(`This action cannot be ran on ${platform}`)
  }

  if (arch === 'x64') {
    distArch = 'x86_64'
  } else {
    throw Error(`This action does not support the ${arch} architecture`)
  }

  const requestedCliVersion = core.getInput('cli-version')
  const includeCliPrereleases = true
  let cliVersionRange = '*'

  let dist = `${platform}-${distArch}`
  if (requestedCliVersion === 'nightly') {
    dist += '.nightly'
  } else if (requestedCliVersion !== 'stable') {
    cliVersionRange = requestedCliVersion
  }

  const indexRequest = await fetch.default(`${EDGEDB_PKG_IDX}/${dist}.json`)
  const index = await indexRequest.json()
  const versionMap = new Map()

  for (const pkg of index.packages) {
    if (pkg.architecture !== distArch) {
      continue
    }

    if (
      !versionMap.has(pkg.version) ||
      versionMap.get(pkg.version).revision < pkg.revision
    ) {
      versionMap.set(pkg.version, pkg)
    }
  }

  const matchingVer = semver.maxSatisfying(
    Array.from(versionMap.keys()),
    cliVersionRange,
    {includePrerelease: includeCliPrereleases}
  )

  if (!matchingVer) {
    throw Error(
      'no published EdgeDB CLI version matches requested version ' +
        `'${cliVersionRange}'`
    )
  }

  let cliDirectory = tc.find('edgedb-cli', matchingVer, arch)
  if (!cliDirectory) {
    const cliPkg = versionMap.get(matchingVer)
    const downloadUrl = `${EDGEDB_PKG_ROOT}/${cliPkg.installref}`
    core.info(
      `Downloading edgedb-cli ${matchingVer} - ${arch} from ${downloadUrl}`
    )
    const downloadPath = await tc.downloadTool(downloadUrl)
    fs.chmodSync(downloadPath, 0o755)
    cliDirectory = await tc.cacheFile(
      downloadPath,
      'edgedb',
      'edgedb-cli',
      matchingVer,
      arch
    )
  }

  return cliDirectory
}
