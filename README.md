<p align="center">
  <a href="https://github.com/edgedb/setup-edgedb/actions"><img alt="setup-edgedb build status" src="https://github.com/edgedb/setup-edgedb/workflows/build-test/badge.svg"></a>
</p>

# setup-edgedb v1

This action downloads and installs EdgeDB CLI and EdgeDB Server and makes
both available in `PATH`.

# Usage

See [action.yml](action.yml) for the action's specification.

Example (installs stable EdgeDB CLI with server and makes them available in `$PATH`)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
      - run: edgedb --version
```

Example (installs latest EdgeDB CLI without server and makes CLI available in `$PATH`)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          cli-version: nightly
          server-version: none
      - run: edgedb --version
```

Example (installs EdgeDB CLI with server, creates new EdgeDB instance and links it using `edgedb project`)
NOTE: this assumes that repository for the project has already been initialized
using `egedb project init` and `edged.toml` file exists in the repository.
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
      - run: edgedb query "SELECT 'Hello from GitHub Actions!'"
```

Example (same as one above, but using `services` from GitHub Actions)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    services:
      edgedb:
        image: edgedb/edgedb:1-rc1
        env:
          EDGEDB_SERVER_INSECURE_DEV_MODE: 1
        ports:
          - 5656:5656
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          project-link: edgedb://localhost:5656
      - run: edgedb query "SELECT 'Hello from GitHub Actions!'"
```

Example (same as above, but with custom instance name)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    services:
      edgedb:
        image: edgedb/edgedb:1-rc1
        env:
          EDGEDB_SERVER_INSECURE_DEV_MODE: 1
        ports:
          - 5656:5656
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          project-link: edgedb://localhost:5656
          instance-name: ci_edgedb_instance
      - run: edgedb query "SELECT 'Hello from GitHub Actions!'"
```

Example (creates new instance but overrides `server-version` from `edgedb.toml`)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          server-version: 1-beta3
          instance-name: ci_edgedb_instance
      - run: edgedb query "SELECT 'Hello from GitHub Actions!'"
```
