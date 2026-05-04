import {expect} from 'chai'
import nock from 'nock'
import * as sinon from 'sinon'

import {ResolveByUrlError} from '../../../../src/server/core/domain/errors/resolve-by-url-error.js'
import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'
import {HttpResolveByUrlService} from '../../../../src/server/infra/space/http-resolve-by-url-service.js'

describe('HttpResolveByUrlService', () => {
  const apiBaseUrl = 'https://iam.example.com/api/v3'
  const sessionKey = 'sess-abc'
  const teamSlug = 'acme'
  const spaceSlug = 'docs'
  let service: HttpResolveByUrlService

  beforeEach(() => {
    sinon.stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
    service = new HttpResolveByUrlService({apiBaseUrl})
  })

  afterEach(() => {
    sinon.restore()
    nock.cleanAll()
  })

  const successResponse = {
    code: 0,
    data: {
      space: {id: 'sp-1', name: 'docs', slug: 'docs'},
      team: {id: 'tm-1', name: 'acme', slug: 'acme'},
      url: 'https://iam.example.com/acme/docs.git',
    },
    message: '',
  }

  describe('anonymous (no sessionKey)', () => {
    it('public space → 200 → returns full metadata, NO x-byterover-session-id header sent', async () => {
      nock(apiBaseUrl, {badheaders: ['x-byterover-session-id']})
        .get('/git/resolve')
        .query({space: spaceSlug, team: teamSlug})
        .reply(200, successResponse)

      const result = await service.resolveByUrl({spaceSlug, teamSlug})

      expect(result.team).to.deep.equal({id: 'tm-1', name: 'acme', slug: 'acme'})
      expect(result.space).to.deep.equal({id: 'sp-1', name: 'docs', slug: 'docs'})
      expect(result.url).to.equal('https://iam.example.com/acme/docs.git')
    })

    it('private space → 403 → throws ResolveByUrlError with statusCode 403', async () => {
      nock(apiBaseUrl)
        .get('/git/resolve')
        .query({space: spaceSlug, team: teamSlug})
        .reply(403, {code: 403, message: 'forbidden'})

      try {
        await service.resolveByUrl({spaceSlug, teamSlug})
        expect.fail('Expected ResolveByUrlError')
      } catch (error) {
        expect(error).to.be.instanceOf(ResolveByUrlError)
        expect((error as ResolveByUrlError).statusCode).to.equal(403)
      }
    })

    it('unknown slugs → 404 → throws ResolveByUrlError with statusCode 404', async () => {
      nock(apiBaseUrl)
        .get('/git/resolve')
        .query({space: 'nope', team: 'nope'})
        .reply(404, {code: 404, message: 'team not found'})

      try {
        await service.resolveByUrl({spaceSlug: 'nope', teamSlug: 'nope'})
        expect.fail('Expected ResolveByUrlError')
      } catch (error) {
        expect(error).to.be.instanceOf(ResolveByUrlError)
        expect((error as ResolveByUrlError).statusCode).to.equal(404)
      }
    })
  })

  describe('authed (sessionKey provided)', () => {
    it('public space → 200 → sends x-byterover-session-id header', async () => {
      nock(apiBaseUrl)
        .get('/git/resolve')
        .query({space: spaceSlug, team: teamSlug})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, successResponse)

      const result = await service.resolveByUrl({spaceSlug, teamSlug}, sessionKey)

      expect(result.team.id).to.equal('tm-1')
      expect(result.space.id).to.equal('sp-1')
    })

    it('private space (member) → 200 → returns full metadata', async () => {
      nock(apiBaseUrl)
        .get('/git/resolve')
        .query({space: spaceSlug, team: teamSlug})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, successResponse)

      const result = await service.resolveByUrl({spaceSlug, teamSlug}, sessionKey)

      expect(result.url).to.equal('https://iam.example.com/acme/docs.git')
    })

    it('private space (non-member) → 403 → throws ResolveByUrlError with statusCode 403', async () => {
      nock(apiBaseUrl)
        .get('/git/resolve')
        .query({space: spaceSlug, team: teamSlug})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(403, {code: 403, message: 'forbidden'})

      try {
        await service.resolveByUrl({spaceSlug, teamSlug}, sessionKey)
        expect.fail('Expected ResolveByUrlError')
      } catch (error) {
        expect(error).to.be.instanceOf(ResolveByUrlError)
        expect((error as ResolveByUrlError).statusCode).to.equal(403)
      }
    })

    it('unknown slugs → 404 → throws ResolveByUrlError with statusCode 404', async () => {
      nock(apiBaseUrl)
        .get('/git/resolve')
        .query({space: 'nope', team: 'nope'})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(404, {code: 404, message: 'team not found'})

      try {
        await service.resolveByUrl({spaceSlug: 'nope', teamSlug: 'nope'}, sessionKey)
        expect.fail('Expected ResolveByUrlError')
      } catch (error) {
        expect(error).to.be.instanceOf(ResolveByUrlError)
        expect((error as ResolveByUrlError).statusCode).to.equal(404)
      }
    })
  })
})
