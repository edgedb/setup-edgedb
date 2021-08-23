import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import * as tc from '@actions/tool-cache'
import * as fs from 'fs'
import * as fetch from 'node-fetch'
import * as os from 'os'
import * as path from 'path'
import * as semver from 'semver'

export const EDGEDB_PKG_ROOT = 'https://packages.edgedb.com'
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
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const cmdline = ['--method', 'package']
  const cli = path.join(cliPath, 'edgedb')

  if (requestedVersion === 'nightly') {
    cmdline.push('--nightly')
  } else if (
    requestedVersion !== undefined &&
    requestedVersion !== '' &&
    requestedVersion !== 'stable'
  ) {
    cmdline.push('--version')
    cmdline.push(requestedVersion)
  }

  const installCmdline = ['server', 'install'].concat(cmdline)
  core.debug(`Running ${cli} ${installCmdline.join(' ')}`)
  await exec.exec(cli, cmdline, options)

  let serverBinPath = ''

  const infoOptions: ExecOptions = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        serverBinPath = data.toString().trim()
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const infoCmdline = ['server', 'info', '--bin-path'].concat(cmdline)
  core.debug(`Running ${cli} ${infoCmdline.join(' ')}`)
  await exec.exec(cli, infoCmdline, infoOptions)

  serverBinPath = fs.realpathSync(serverBinPath)
  return path.dirname(serverBinPath)
}

async function installCLI(): Promise<string> {
  const requestedCliVersion = core.getInput('cli-version')
  const arch = os.arch()
  const includeCliPrereleases = true
  let cliVersionRange = '*'
  let dist = getBaseDist(arch, os.platform())

  if (requestedCliVersion === 'nightly') {
    dist += '.nightly'
  } else if (requestedCliVersion !== 'stable') {
    cliVersionRange = requestedCliVersion
  }

  const versionMap = await getVersionMap(dist)
  const matchingVer = await getMatchingVer(
    versionMap,
    cliVersionRange,
    includeCliPrereleases
  )

  let cliDirectory = tc.find('edgedb-cli', matchingVer, arch)
  if (!cliDirectory) {
    const cliPkg = versionMap.get(matchingVer)
    const downloadUrl = new URL(cliPkg.installref, EDGEDB_PKG_ROOT).href
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

export async function getMatchingVer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  versionMap: Map<string, any>,
  cliVersionRange: string,
  includeCliPrereleases: boolean
): Promise<string> {
  const versions = Array.from(versionMap.keys()).filter(ver =>
    semver.satisfies(ver, cliVersionRange, {
      includePrerelease: includeCliPrereleases
    })
  )
  versions.sort(semver.compareBuild)
  if (versions.length > 0) {
    return versions[versions.length - 1]
  } else {
    throw Error(
      'no published EdgeDB CLI version matches requested version ' +
        `'${cliVersionRange}'`
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getVersionMap(dist: string): Promise<Map<string, any>> {
  const indexRequest = await fetch.default(`${EDGEDB_PKG_IDX}/${dist}.json`)
  const index = await indexRequest.json()
  const versionMap = new Map()

  for (const pkg of index.packages) {
    if (pkg.name !== 'edgedb-cli') {
      continue
    }

    if (
      !versionMap.has(pkg.version) ||
      versionMap.get(pkg.version).revision < pkg.revision
    ) {
      versionMap.set(pkg.version, pkg)
    }
  }

  return versionMap
}

export function getBaseDist(arch: string, platform: string): string {
  let distArch = ''
  let distPlatform = ''

  if (platform === 'linux') {
    distPlatform = platform
  } else if (platform === 'darwin') {
    distPlatform = 'macos'
  } else {
    throw Error(`This action cannot be run on ${platform}`)
  }

  if (arch === 'x64') {
    distArch = 'x86_64'
  } else {
    throw Error(`This action does not support the ${arch} architecture`)
  }

  return `${distPlatform}-${distArch}`
}
