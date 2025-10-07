byterover-cli
=================

ByteRover's CLI


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g byterover-cli
$ br COMMAND
running command...
$ br (--version)
byterover-cli/0.0.0 darwin-arm64 node-v22.19.0
$ br --help [COMMAND]
USAGE
  $ br COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`br hello PERSON`](#br-hello-person)
* [`br hello world`](#br-hello-world)
* [`br help [COMMAND]`](#br-help-command)
* [`br plugins`](#br-plugins)
* [`br plugins add PLUGIN`](#br-plugins-add-plugin)
* [`br plugins:inspect PLUGIN...`](#br-pluginsinspect-plugin)
* [`br plugins install PLUGIN`](#br-plugins-install-plugin)
* [`br plugins link PATH`](#br-plugins-link-path)
* [`br plugins remove [PLUGIN]`](#br-plugins-remove-plugin)
* [`br plugins reset`](#br-plugins-reset)
* [`br plugins uninstall [PLUGIN]`](#br-plugins-uninstall-plugin)
* [`br plugins unlink [PLUGIN]`](#br-plugins-unlink-plugin)
* [`br plugins update`](#br-plugins-update)

## `br hello PERSON`

Say hello

```
USAGE
  $ br hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ br hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/hello/index.ts)_

## `br hello world`

Say hello world

```
USAGE
  $ br hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ br hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/hello/world.ts)_

## `br help [COMMAND]`

Display help for br.

```
USAGE
  $ br help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for br.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.33/src/commands/help.ts)_

## `br plugins`

List installed plugins.

```
USAGE
  $ br plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ br plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/index.ts)_

## `br plugins add PLUGIN`

Installs a plugin into br.

```
USAGE
  $ br plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into br.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the BR_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the BR_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ br plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ br plugins add myplugin

  Install a plugin from a github url.

    $ br plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ br plugins add someuser/someplugin
```

## `br plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ br plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ br plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/inspect.ts)_

## `br plugins install PLUGIN`

Installs a plugin into br.

```
USAGE
  $ br plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into br.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the BR_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the BR_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ br plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ br plugins install myplugin

  Install a plugin from a github url.

    $ br plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ br plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/install.ts)_

## `br plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ br plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ br plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/link.ts)_

## `br plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ br plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ br plugins unlink
  $ br plugins remove

EXAMPLES
  $ br plugins remove myplugin
```

## `br plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ br plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/reset.ts)_

## `br plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ br plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ br plugins unlink
  $ br plugins remove

EXAMPLES
  $ br plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/uninstall.ts)_

## `br plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ br plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ br plugins unlink
  $ br plugins remove

EXAMPLES
  $ br plugins unlink myplugin
```

## `br plugins update`

Update installed plugins.

```
USAGE
  $ br plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/update.ts)_
<!-- commandsstop -->
