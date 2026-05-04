import {expect} from 'chai'

import {PostWorkRegistry} from '../../../../src/server/infra/daemon/post-work-registry.js'

const noop = (): void => {
  // intentionally empty
}

/** Manually-resolvable promise — lets a test step through ordering invariants without sleeps. */
function deferred<T = void>(): {promise: Promise<T>; reject: (err: Error) => void; resolve: (value: T) => void;} {
  let resolve: (value: T) => void = noop
  let reject: (err: Error) => void = noop
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, reject, resolve}
}

/** A never-resolving promise — feeds drain() with a thunk that exceeds the timeout. */
function neverResolves(): Promise<void> {
  return new Promise<void>((_resolve) => {
    // never call resolve
  })
}

describe('PostWorkRegistry', () => {
  describe('submit', () => {
    it('runs the submitted thunk asynchronously', async () => {
      const registry = new PostWorkRegistry()
      const ran: string[] = []
      const done = deferred<void>()

      registry.submit('/projA', async () => {
        ran.push('thunk')
        done.resolve()
      })

      // submit returns synchronously; the thunk has not necessarily started yet
      ran.push('after-submit')

      await done.promise
      expect(ran).to.deep.equal(['after-submit', 'thunk'])
    })

    it('serialises work for the same project (per-project mutex)', async () => {
      const registry = new PostWorkRegistry()
      const order: string[] = []
      const a = deferred<void>()
      const b = deferred<void>()
      const aStarted = deferred<void>()
      const bStarted = deferred<void>()

      registry.submit('/proj', async () => {
        order.push('a-start')
        aStarted.resolve()
        await a.promise
        order.push('a-end')
      })
      registry.submit('/proj', async () => {
        order.push('b-start')
        bStarted.resolve()
        await b.promise
        order.push('b-end')
      })

      // A starts immediately; B is blocked by mutex until A completes.
      await aStarted.promise
      // Let several macro/microtasks run — B must NOT start while A is awaiting `a`.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      expect(order).to.deep.equal(['a-start'])

      // Release A. B should start after A finishes.
      a.resolve()
      await bStarted.promise
      expect(order).to.deep.equal(['a-start', 'a-end', 'b-start'])

      // Release B and wait for the project tail to drain.
      b.resolve()
      await registry.awaitProject('/proj')
      expect(order).to.deep.equal(['a-start', 'a-end', 'b-start', 'b-end'])
    })

    it('runs work for different projects concurrently', async () => {
      const registry = new PostWorkRegistry()
      const order: string[] = []
      const a = deferred<void>()
      const b = deferred<void>()

      registry.submit('/projA', async () => {
        order.push('A-start')
        await a.promise
        order.push('A-end')
      })
      registry.submit('/projB', async () => {
        order.push('B-start')
        await b.promise
        order.push('B-end')
      })

      await Promise.resolve()
      await Promise.resolve()
      // Both should have started — different projects, no shared mutex.
      expect(order).to.have.members(['A-start', 'B-start'])

      a.resolve()
      b.resolve()
      await registry.awaitProject('/projA')
      await registry.awaitProject('/projB')
      expect(order).to.have.members(['A-start', 'B-start', 'A-end', 'B-end'])
    })

    it('isolates errors — a thrown thunk does not block subsequent submissions', async () => {
      const registry = new PostWorkRegistry()
      const order: string[] = []

      registry.submit('/proj', async () => {
        order.push('a')
        throw new Error('boom')
      })
      registry.submit('/proj', async () => {
        order.push('b')
      })

      await registry.awaitProject('/proj')
      expect(order).to.deep.equal(['a', 'b'])
    })
  })

  describe('awaitProject', () => {
    it('resolves immediately when there is no work for the project', async () => {
      const registry = new PostWorkRegistry()
      const start = Date.now()
      await registry.awaitProject('/never-submitted')
      expect(Date.now() - start).to.be.lessThan(50)
    })

    it('resolves only after all queued work for the project completes', async () => {
      const registry = new PostWorkRegistry()
      const work = deferred<void>()
      let done = false

      registry.submit('/proj', async () => {
        await work.promise
      })

      const awaitPromise = registry.awaitProject('/proj').then(() => {
        done = true
      })

      await Promise.resolve()
      expect(done).to.equal(false)

      work.resolve()
      await awaitPromise
      expect(done).to.equal(true)
    })

    it('does not wait for work submitted to other projects', async () => {
      const registry = new PostWorkRegistry()
      const otherWork = deferred<void>()

      registry.submit('/other', async () => {
        await otherWork.promise
      })

      const start = Date.now()
      await registry.awaitProject('/proj')
      expect(Date.now() - start).to.be.lessThan(50)
      otherWork.resolve()
      await registry.awaitProject('/other')
    })
  })

  describe('awaitAll', () => {
    it('resolves immediately when there is no work in any project', async () => {
      const registry = new PostWorkRegistry()
      const start = Date.now()
      await registry.awaitAll()
      expect(Date.now() - start).to.be.lessThan(50)
    })

    it('resolves only after every queued tail completes (multi-project)', async () => {
      const registry = new PostWorkRegistry()
      const a = deferred<void>()
      const b = deferred<void>()
      let done = false

      registry.submit('/projA', async () => {
        await a.promise
      })
      registry.submit('/projB', async () => {
        await b.promise
      })

      const awaiting = registry.awaitAll().then(() => {
        done = true
      })

      // Neither project finished yet — awaitAll must block.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      expect(done).to.equal(false)

      a.resolve()
      // Still waiting on B.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      expect(done).to.equal(false)

      b.resolve()
      await awaiting
      expect(done).to.equal(true)
    })

    it('does not block on submissions arriving after the call', async () => {
      // Tail captured at call time (matches awaitProject semantics) — the
      // hot-swap caller needs a deterministic completion, not an open wait.
      const registry = new PostWorkRegistry()
      const a = deferred<void>()
      registry.submit('/proj', async () => {
        await a.promise
      })

      const awaiting = registry.awaitAll()
      const b = deferred<void>()
      registry.submit('/proj', async () => {
        await b.promise
      })

      a.resolve()
      await awaiting
      b.resolve()
      await registry.awaitProject('/proj')
    })
  })

  describe('drain', () => {
    it('returns when all in-flight work across all projects completes', async () => {
      const registry = new PostWorkRegistry()
      const a = deferred<void>()
      const b = deferred<void>()

      registry.submit('/projA', async () => { await a.promise })
      registry.submit('/projB', async () => { await b.promise })

      const drainPromise = registry.drain(5000)
      await Promise.resolve()

      a.resolve()
      b.resolve()

      const result = await drainPromise
      expect(result.drained).to.equal(2)
      expect(result.abandoned).to.equal(0)
    })

    it('abandons work that does not finish within the timeout', async () => {
      const registry = new PostWorkRegistry()
      registry.submit('/proj', neverResolves)

      const result = await registry.drain(50)
      expect(result.drained).to.equal(0)
      expect(result.abandoned).to.equal(1)
    })

    it('counts errored thunks as drained, not abandoned', async () => {
      const registry = new PostWorkRegistry()
      registry.submit('/proj', async () => {
        throw new Error('failure inside drain')
      })

      const result = await registry.drain(1000)
      expect(result.drained).to.equal(1)
      expect(result.abandoned).to.equal(0)
    })
  })
})
