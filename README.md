<p align="center">
  <a href="https://github.com/edgedb/setup-edgedb/actions"><img alt="setup-edgedb build status" src="https://github.com/edgedb/setup-edgedb/workflows/build-test/badge.svg"></a>
</p>

# setup-edgedb v1

This action downloads and installs EdgeDB CLI and EdgeDB Server and makes
both available in `PATH`.

# Usage

See [action.yml](action.yml) for the action's specification.

Example (installs stable EdgeDB CLI and makes it available in `$PATH`)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB CLI
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          server-version: none
      - run: edgedb --version
```

Example (installs latest EdgeDB CLI and makes it available in `$PATH`)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB CLI
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          cli-version: nightly
          server-version: none
      - run: edgedb --version
```

Example (installs EdgeDB CLI and links running EdgeDB server with project)
NOTE: this assumes that repository for the project has already been initialized
using `egedb project init` and `edged.toml` file exists in the repository.
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB CLI
    services:
      edgedb:
        image: edgedb/edgedb:1-beta3
        env:
          EDGEDB_USER: edgedb
          EDGEDB_PASSWORD: very_secure_password
          EDGEDB_GENERATE_SELF_SIGNED_CERT: 1
        ports:
          - 5656:5656
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          server-version: none
          password: very_secure_password
          instance: example_name
      - run: edgedb query "SELECT 'Hello from GitHub Actions!'"
```
