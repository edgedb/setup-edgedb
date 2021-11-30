<p align="center">
  <a href="https://github.com/edgedb/setup-edgedb/actions"><img alt="setup-edgedb build status" src="https://github.com/edgedb/setup-edgedb/workflows/build-test/badge.svg"></a>
</p>

# setup-edgedb v1

This action downloads and installs EdgeDB CLI and EdgeDB Server and makes
both available in `PATH`.

# Usage

See [action.yml](action.yml) for the action's specification.

How this action works:

This action executes different commands depending on state of files in repository and inputs for action in workflow. It can:
1. Install EdgeDB tools (CLI and server)
2. Create new EdgeDB instance
3. Initialize new [EdgeDB project](https://www.edgedb.com/docs/cli/edgedb_project/index) or link an existing one to remote instance

The following examples show how to use this action.

Example (installs stable EdgeDB CLI with server and makes them available in `$PATH`)
Note: if your repository has `edgedb.toml` file, then this action will also initialize new project for your workflow.
Otherwise, it will just install EdgeDB CLI and executable server that you can use on your own.

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

Example (installs EdgeDB CLI with server, creates new EdgeDB instance and links it using `edgedb project init`)
NOTE: this assumes that repository for the project has already been initialized
using `edgedb project init` and `edgedb.toml` file exists in the repository.
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
      - run: edgedb query "SELECT 'Hello from GitHub Actions'"
```

Example (same as one above, but using `services` from GitHub Actions and `edgedb project init --link`)
```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    name: CI with EdgeDB action
    services:
      edgedb:
        image: edgedb/edgedb:1-rc2
        env:
          EDGEDB_SERVER_SECURITY: insecure_dev_mode
        ports:
          - 5656:5656
    steps:
      - uses: actions/checkout@v2
      - uses: edgedb/setup-edgedb@v1
        with:
          server-dsn: edgedb://localhost:5656
          instance-name: ci_edgedb_instance  # optional
      - run: edgedb query "SELECT 'Hello from GitHub Actions'"
```

Example (creates new instance, but overrides `server-version` from `edgedb.toml` if project initialization is to be used)
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
          server-version: 1.0-rc.2
          instance-name: ci_edgedb_instance
      - run: edgedb query "SELECT 'Hello from GitHub Actions'"
```
