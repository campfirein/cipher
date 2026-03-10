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
    if (len < 4) {
      offset += 4
      continue
    }

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

  let lsRefsResponse: Awaited<ReturnType<typeof httpRequest>>
  try {
    lsRefsResponse = await httpRequest({
      body: singleChunk(LS_REFS_REQUEST),
      headers: {
        ...params.headers,
        'Content-Type': 'application/x-git-upload-pack-request',
        'Git-Protocol': 'version=2',
      },
      method: 'POST',
      url: `${baseUrl}/git-upload-pack`,
    })
  } catch (error) {
    throw new Error(
      `Failed to translate Git Protocol v2 to v1 (ls-refs POST to ${baseUrl}/git-upload-pack failed): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const lsChunks: Buffer[] = []
  for await (const chunk of lsRefsResponse.body ?? []) {
    lsChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const lsBody = Buffer.concat(lsChunks)

  const refs = await parseLsRefsBody(lsBody)
  const v1Body = buildV1RefsAdvertisement('git-upload-pack', refs)

  return {...originalResponse, body: singleChunk(v1Body)} satisfies GitHttpResponse
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
 *     This wrapper translates the v2 response to v1 by making a secondary ls-refs
 *     POST request, then synthesising a compliant v1 refs advertisement.
 */
export const gitHttpWrapper: {request: typeof httpRequest} = {
  async request(params) {
    const response = await httpRequest(params)
    const url = String(params.url)

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
