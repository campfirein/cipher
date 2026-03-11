import type {GitHttpResponse} from 'isomorphic-git'

import {request as httpRequest} from 'isomorphic-git/http/node'

/**
 * Pktline-encoded service announcement preambles.
 *
 * Git Smart HTTP Protocol v1 requires the info/refs response to start with:
 *   <pktline># service=<service>\n
 *   0000
 *
 * Lengths:
 *   "# service=git-receive-pack\n" = 27 bytes + 4 prefix = 31 = 0x1f → "001f"
 *   "# service=git-upload-pack\n"  = 26 bytes + 4 prefix = 30 = 0x1e → "001e"
 */
const SERVICE_PREAMBLES: Record<string, string> = {
  'git-receive-pack': '001f# service=git-receive-pack\n0000',
  'git-upload-pack': '001e# service=git-upload-pack\n0000',
}

/**
 * V2 ls-refs request body (pktline-encoded).
 *
 * Format: command section + delimiter (0000) + argument section + flush (0000)
 *   "command=ls-refs\n" = 16 chars + 4 prefix = 20 = 0x14 → "0014"
 *   "peel\n"            =  5 chars + 4 prefix =  9 = 0x09 → "0009"
 *   "symrefs\n"         =  8 chars + 4 prefix = 12 = 0x0c → "000c"
 */
const LS_REFS_REQUEST = Buffer.from('0014command=ls-refs\n00000009peel\n000csymrefs\n0000')

async function* singleChunk(buffer: Buffer): AsyncIterableIterator<Uint8Array> {
  yield buffer
}

/** Encode a string as a pktline: 4-char hex length (including the 4 bytes) + content */
function pktline(content: string): string {
  const len = Buffer.byteLength(content, 'utf8') + 4
  return len.toString(16).padStart(4, '0') + content
}

/**
 * Parse the ls-refs response body into a list of {sha, name} entries.
 *
 * Each pktline line looks like: "<sha> <refname>\n"
 * or with symref:               "<sha> <refname> symref-target:<target>\n"
 */
async function parseLsRefsBody(body: Buffer): Promise<Array<{name: string; sha: string; symref?: string}>> {
  const refs: Array<{name: string; sha: string; symref?: string}> = []
  let offset = 0
  while (offset + 4 <= body.length) {
    const lenHex = body.subarray(offset, offset + 4).toString('ascii')
    const len = Number.parseInt(lenHex, 16)
    if (len === 0) break // flush packet
    if (len < 4) break // malformed pktline — cannot advance safely, treat as end-of-stream

    const line = body
      .subarray(offset + 4, offset + len)
      .toString('utf8')
      .replace(/\n$/, '')
    offset += len
    const parts = line.split(' ')
    if (parts.length < 2) continue
    const sha = parts[0]
    const name = parts[1]
    const symrefPart = parts.find((p) => p.startsWith('symref-target:'))
    const symref = symrefPart ? symrefPart.slice('symref-target:'.length) : undefined
    refs.push({name, sha, symref})
  }

  return refs
}

/**
 * Build a synthetic Git Protocol v1 refs advertisement buffer from a list of refs.
 *
 * Format:
 *   <preamble>
 *   0000                                          ← preamble flush
 *   <len><sha> <first-ref>\0<capabilities>\n      ← first ref (NUL + caps)
 *   <len><sha> <other-ref>\n                      ← subsequent refs
 *   ...
 *   0000                                          ← end flush
 *
 * If there are no refs, returns just the preamble + two flushes (empty repo case).
 */
function buildV1RefsAdvertisement(service: string, refs: Array<{name: string; sha: string; symref?: string}>): Buffer {
  const preamble = SERVICE_PREAMBLES[service]

  if (refs.length === 0) {
    // Empty repo: preamble + flush + zero-id capabilities line + flush
    const zeroId = '0'.repeat(40)
    const capsLine = pktline(`${zeroId} capabilities^\0side-band-64k ofs-delta\n`)
    return Buffer.from(preamble + capsLine + '0000')
  }

  // Build capabilities string (v1 format)
  const capabilities: string[] = ['side-band-64k', 'ofs-delta', 'agent=git/isomorphic-git']

  // Add symref for HEAD if we know it
  const headRef = refs.find((r) => r.name === 'HEAD')
  if (headRef?.symref) {
    capabilities.push(`symref=HEAD:${headRef.symref}`)
  } else if (headRef) {
    // Infer symref: find a non-HEAD ref with the same SHA as HEAD
    const matchingBranch = refs.find((r) => r.name !== 'HEAD' && r.sha === headRef.sha)
    if (matchingBranch) {
      capabilities.push(`symref=HEAD:${matchingBranch.name}`)
    }
  }

  const capsStr = capabilities.join(' ')

  // Git Protocol v1 requires HEAD to be the first ref (it carries the capabilities line)
  const sorted = [...refs].sort((a, b) => (a.name === 'HEAD' ? -1 : b.name === 'HEAD' ? 1 : 0))

  let body = preamble
  for (const [i, {name, sha}] of sorted.entries()) {
    // First ref includes NUL + capabilities
    body += i === 0 ? pktline(`${sha} ${name}\0${capsStr}\n`) : pktline(`${sha} ${name}\n`)
  }

  body += '0000'

  return Buffer.from(body)
}

/**
 * Detects whether a buffered info/refs response body is a Git Protocol v2
 * capability advertisement (starts with "000eversion 2").
 */
function isProtocolV2Response(body: Buffer): boolean {
  return body.subarray(0, 14).toString('ascii') === '000eversion 2\n'
}

/**
 * When the server returns a Protocol v2 response for git-upload-pack, isomorphic-git
 * (which requests Protocol v1) cannot use it directly — its v1 fetch logic accesses
 * `remoteHTTP.refs` which is `undefined` for v2 discovery results.
 *
 * This function translates the v2 response to v1 by making a secondary ls-refs POST
 * request, then synthesising a valid Protocol v1 refs advertisement.
 */
async function translateUploadPackV2ToV1(
  params: Parameters<typeof httpRequest>[0],
  originalResponse: Awaited<ReturnType<typeof httpRequest>>,
): Promise<GitHttpResponse> {
  const baseUrl = String(params.url).replace(/\/info\/refs\?service=git-upload-pack.*$/, '')

  // Use native fetch instead of isomorphic-git's httpRequest to avoid the
  // "require is not defined" error that occurs when httpRequest processes a POST
  // body in an ESM context (it lazily loads node:stream via require()).
  let lsBody: Buffer
  try {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const fetchResponse = await fetch(`${baseUrl}/git-upload-pack`, {
      body: LS_REFS_REQUEST,
      headers: {
        ...(params.headers as Record<string, string>),
        'Content-Type': 'application/x-git-upload-pack-request',
        'Git-Protocol': 'version=2',
      },
      method: 'POST',
    })
    lsBody = Buffer.from(await fetchResponse.arrayBuffer())
  } catch (error) {
    throw new Error(
      `Failed to translate Git Protocol v2 to v1 (ls-refs POST to ${baseUrl}/git-upload-pack failed): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const refs = await parseLsRefsBody(lsBody)
  const v1Body = buildV1RefsAdvertisement('git-upload-pack', refs)

  return {...originalResponse, body: singleChunk(v1Body)} satisfies GitHttpResponse
}

/**
 * Intercept a v1-format git-upload-pack POST from isomorphic-git and convert
 * it to a Git Protocol v2 fetch command, since the CoGit server only handles v2.
 *
 * Parses the v1 pktlines (want/have/done) and re-sends as v2 format using
 * native fetch to avoid the `require is not defined` ESM issue in httpRequest.
 *
 * The v2 packfile response is passed back after stripping the "packfile" section
 * header pktline (if present), so isomorphic-git sees a v1-compatible sideband stream.
 */
async function interceptUploadPackPost(params: Parameters<typeof httpRequest>[0]): Promise<GitHttpResponse> {
  // Buffer the v1 body from isomorphic-git
  const chunks: Buffer[] = []
  for await (const chunk of params.body ?? []) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const v1Body = Buffer.concat(chunks)

  // Parse v1 pktlines: extract want SHAs, have SHAs, and done flag.
  // The first "want" line includes capabilities (e.g. "want <sha> side-band-64k ofs-delta") —
  // we only keep the 40-char SHA; capabilities are dropped since v2 handles them differently.
  const wants: string[] = []
  const haves: string[] = []
  let done = false
  let offset = 0
  while (offset + 4 <= v1Body.length) {
    const lenHex = v1Body.subarray(offset, offset + 4).toString('ascii')
    const len = Number.parseInt(lenHex, 16)
    if (len === 0) {
      offset += 4
      continue
    }

    if (len < 4) break
    const line = v1Body
      .subarray(offset + 4, offset + len)
      .toString('utf8')
      .replace(/\n$/, '')
    offset += len

    if (line.startsWith('want ')) {
      wants.push(line.split(' ')[1]) // 40-char SHA only, ignore capabilities
    } else if (line.startsWith('have ')) {
      haves.push(line.split(' ')[1])
    } else if (line === 'done') {
      done = true
    }
  }

  // Build a v2 fetch command body.
  // '0001' is the delim-pkt (Git Protocol v2) that separates the command
  // section from the argument section. '0000' (flush-pkt) would signal
  // end-of-request, causing the server to ignore all want/done arguments.
  let v2 = pktline('command=fetch\n') + '0001'
  for (const sha of wants) v2 += pktline(`want ${sha}\n`)
  for (const sha of haves) v2 += pktline(`have ${sha}\n`)
  if (done) v2 += pktline('done\n')
  v2 += '0000'

  const url = String(params.url)
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  const fetchResponse = await fetch(url, {
    body: Buffer.from(v2),
    headers: {
      ...(params.headers as Record<string, string>),
      'Content-Type': 'application/x-git-upload-pack-request',
      'Git-Protocol': 'version=2',
    },
    method: 'POST',
  })

  if (!fetchResponse.ok) {
    throw new Error(`HTTP Error: ${fetchResponse.status} ${fetchResponse.statusText}`)
  }

  const v2ResponseBody = Buffer.from(await fetchResponse.arrayBuffer())

  // Strip the v2 "packfile" section header pktline (if present) so that
  // isomorphic-git receives a v1-compatible sideband stream starting with
  // the first real sideband byte (0x01 = packfile data, 0x02 = progress).
  const responseBody = stripV2PackfileSectionHeader(v2ResponseBody)

  return {
    body: singleChunk(responseBody),
    headers: Object.fromEntries(fetchResponse.headers.entries()),
    method: 'POST',
    statusCode: fetchResponse.status,
    statusMessage: fetchResponse.statusText,
    url,
  } satisfies GitHttpResponse
}

/**
 * Git Protocol v2 fetch responses wrap the packfile in a "packfile" section.
 * Strip that section-header pktline so isomorphic-git sees a v1-compatible
 * sideband stream (first byte of each pktline is the sideband code).
 */
function stripV2PackfileSectionHeader(body: Buffer): Buffer {
  if (body.length < 4) return body
  const lenHex = body.subarray(0, 4).toString('ascii')
  const len = Number.parseInt(lenHex, 16)
  if (len < 4 || len > body.length) return body
  // Strip optional sideband-1 prefix byte (0x01 = pack-data band) then check for "packfile\n"
  let payload = body.subarray(4, len)
  if (payload[0] === 0x01) payload = payload.subarray(1)
  const content = payload.toString('utf8').replace(/\n$/, '')
  if (content === 'packfile') return body.subarray(len)
  return body
}

/**
 * Wraps isomorphic-git's HTTP client to ensure Git Smart HTTP Protocol v1 compliance.
 *
 * ByteRover CoGit exhibits two non-standard behaviours:
 *
 *  1. git-receive-pack (push): Returns a valid pktline ref advertisement with the
 *     correct Content-Type, but OMITS the required `# service=git-receive-pack\n`
 *     preamble. This wrapper injects the missing preamble.
 *
 *  2. git-upload-pack (fetch/clone): Always returns a Git Protocol v2 capability
 *     advertisement, even when the client does not request v2. isomorphic-git uses
 *     Protocol v1 internally and cannot use a v2 response for its fetch logic.
 *     This wrapper:
 *       a. Translates the info/refs v2 response to v1 (ls-refs POST + synthetic refs advertisement)
 *       b. Intercepts the subsequent pack-data POST and converts it from v1 to v2 fetch command
 */
export const gitHttpWrapper: {request: typeof httpRequest} = {
  async request(params) {
    const url = String(params.url)

    // Intercept git-upload-pack pack-data POST (not info/refs):
    // isomorphic-git sends v1 want/have/done but the server only understands v2.
    if (url.includes('/git-upload-pack') && !url.includes('/info/refs')) {
      return interceptUploadPackPost(params)
    }

    const response = await httpRequest(params)

    const service = url.includes('/info/refs?service=git-receive-pack')
      ? 'git-receive-pack'
      : url.includes('/info/refs?service=git-upload-pack')
        ? 'git-upload-pack'
        : null

    if (!service) return response

    const headers = response.headers ?? {}
    const expectedType = `application/x-${service}-advertisement`
    if (headers['content-type'] !== expectedType) return response

    // Buffer the full body to inspect it
    const chunks: Buffer[] = []
    for await (const chunk of response.body ?? []) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const body = Buffer.concat(chunks)

    // For upload-pack: server forces Protocol v2 → translate to v1 for isomorphic-git
    if (service === 'git-upload-pack' && isProtocolV2Response(body)) {
      return translateUploadPackV2ToV1(params, response)
    }

    const preamble = SERVICE_PREAMBLES[service]

    // If the v1 preamble is already present, return the buffered body as-is
    if (body.toString('utf8', 0, preamble.length) === preamble) {
      return {...response, body: singleChunk(body)} satisfies GitHttpResponse
    }

    // Inject the missing v1 preamble before the ref advertisement
    return {
      ...response,
      body: singleChunk(Buffer.concat([Buffer.from(preamble), body])),
    } satisfies GitHttpResponse
  },
}
