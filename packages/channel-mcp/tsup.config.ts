import {defineConfig} from 'tsup'

export default defineConfig({
  // Self-contained dist/server.js so hosts can point their MCP config at
  // one absolute path. @brv/channel-client + socket.io-client are
  // inlined; MCP SDK + zod stay external because host runtimes ship
  // their own. The createRequire banner unblocks transitive CJS modules
  // pulled in by socket.io-client (xmlhttprequest-ssl).
  banner: {
    js: [
      "import {createRequire as __brvCreateRequire} from 'node:module';",
      "const require = __brvCreateRequire(import.meta.url);",
    ].join('\n'),
  },
  clean: true,
  dts: true,
  entry: ['src/server.ts'],
  format: ['esm'],
  minify: false,
  noExternal: ['@brv/channel-client', 'socket.io-client'],
  sourcemap: true,
  splitting: false,
  target: 'es2022',
})
