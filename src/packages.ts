import * as exec from '@actions/exec'
import fetch from 'node-fetch'
import * as os from 'os'
import * as semver from 'semver'
import {groupToMapBy} from './util'

const EDGEDB_PKG_ROOT = 'https://packages.edgedb.com'
const EDGEDB_PKG_IDX = `${EDGEDB_PKG_ROOT}/archive/.jsonindexes`

export type PackageIndex = readonly Package[]

export interface Package {
  name: string
  version: string
  revision: string
  architecture: DistArchitecture
  installref: string
  downloadUrl: string
}

type DistArchitecture = 'x86_64' | 'aarch64'

export async function getCliPackage(
  requestedVersion: string
): Promise<Package> {
  const nightly = requestedVersion === 'nightly'
  const index = await getPackageIndex(nightly)
  const cliPkg = findBestPackage(
    index,
    'edgedb-cli',
    requestedVersion === 'stable' || nightly ? '*' : requestedVersion
  )
  if (!cliPkg) {
    throw new Error(
      `no published EdgeDB CLI version matches requested version '${requestedVersion}'`
    )
  }
  return cliPkg
}

export function findBestPackage(
  packages: PackageIndex,
  name: string,
  versionRange: string,
  includePrerelease = true
): Package | undefined {
  const matches = packages
    .flatMap(pkg => {
      if (pkg.name !== name) {
        return []
      }
      // Handle versions without a patch version
      let [v] = pkg.version.split('+')
      if (v.match(/\./gm)?.length === 1) {
        v = `${v}.0`
      }
      const inRange = semver.satisfies(v, versionRange, {
        includePrerelease
      })
      return inRange ? {v, pkg} : []
    })
    .sort((a, b) => semver.compareBuild(b.v, a.v))
  return matches[0]?.pkg
}

export async function getPackageIndex(nightly = false): Promise<PackageIndex> {
  const url = await getPackageIndexUrl(nightly)
  const indexRes = await fetch(url)
  const index = (await indexRes.json()) as {packages: readonly Package[]}
  // Enhance with full download URL
  const packages = index.packages.map(pkg => ({
    ...pkg,
    downloadUrl: `${EDGEDB_PKG_ROOT}${pkg.installref}`
  }))
  // Limit packages to the latest revision for each package version
  return [
    ...groupToMapBy(packages, pkg => `${pkg.name}-${pkg.version}`).values()
  ].map(pkgs => [...pkgs].sort(compareRevDesc)[0])
}

const compareRevDesc = (a: Package, b: Package): number =>
  Number(b.revision) - Number(a.revision)

export async function getPackageIndexUrl(nightly = false): Promise<string> {
  const arch = getDistArch()
  const platform = await getDistPlatform()
  return `${EDGEDB_PKG_IDX}/${arch}-${platform}${
    nightly ? '.nightly' : ''
  }.json`
}

function getDistArch(): DistArchitecture {
  const arch = os.arch()
  if (arch === 'x64') {
    return 'x86_64'
  } else if (arch === 'arm64') {
    return 'aarch64'
  } else {
    throw new Error(`This action does not support the ${arch} architecture`)
  }
}

async function getDistPlatform(): Promise<string> {
  const platform = os.platform()
  if (platform === 'win32') {
    const wslPlatform = (await exec.getExecOutput('wsl uname')).stdout
      .trim()
      .toLocaleLowerCase()
    return wslPlatform === 'linux' ? `unknown-linux-musl` : wslPlatform
  }
  if (platform === 'linux') {
    return `unknown-linux-musl`
  } else if (platform === 'darwin') {
    return 'apple-darwin'
  } else {
    throw new Error(`This action cannot be run on ${platform}`)
  }
}
