import * as main from './main'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as os from 'os'

export async function run(): Promise<void> {
  try {
    await installCLI()
    await installServer()
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function checkOutput(cmd: string, args?: string[]): Promise<string> {
  let out = ''

  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        out += data.toString()
      }
    }
  }

  await exec.exec(cmd, args, options)
  return out.trim()
}

async function getBaseDist(): Promise<string> {
  const arch = os.arch()
  const platform = (await checkOutput('wsl uname')).toLocaleLowerCase()

  return main.getBaseDist(arch, platform)
}

async function installCLI(): Promise<void> {
  const requestedCLIVersion = core.getInput('cli-version')
  const arch = os.arch()
  const includeCliPrereleases = true
  let cliVersionRange = '*'
  let dist = await getBaseDist()

  if (requestedCLIVersion === 'nightly') {
    dist += '.nightly'
  } else if (requestedCLIVersion !== 'stable') {
    cliVersionRange = requestedCLIVersion
  }

  const versionMap = await main.getVersionMap(dist)
  const matchingVer = await main.getMatchingVer(
    versionMap,
    cliVersionRange,
    includeCliPrereleases
  )
  const cliPkg = versionMap.get(matchingVer)
  const downloadUrl = new URL(cliPkg.installref, main.EDGEDB_PKG_ROOT).href

  core.info(
    `Downloading edgedb-cli ${matchingVer} - ${arch} from ${downloadUrl}`
  )

  await checkOutput('wsl', [
    'curl',
    '--fail',
    '--output',
    '/usr/bin/edgedb',
    downloadUrl
  ])
  await checkOutput('wsl chmod +x /usr/bin/edgedb')
}

async function installServer(): Promise<void> {
  const requestedVersion = core.getInput('server-version')

  const args = ['edgedb', 'server', 'install', '--method', 'package']

  if (requestedVersion === 'nightly') {
    args.push('--nightly')
  } else if (requestedVersion !== '' && requestedVersion !== 'stable') {
    args.push('--version')
    args.push(requestedVersion)
  }

  await checkOutput('wsl', args)
  const bin = await checkOutput('wsl ls /usr/bin/edgedb-server-*')

  if (bin === '') {
    throw Error('could not find edgedb-server bin')
  }

  await checkOutput('wsl', ['ln', '-s', bin.trim(), '/usr/bin/edgedb-server'])
}
