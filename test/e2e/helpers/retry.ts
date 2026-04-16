const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export async function retry<T>(fn: () => Promise<T>, opts?: {delay?: number; retries?: number}): Promise<T> {
  const retries = opts?.retries ?? 3
  const delay = opts?.delay ?? 250
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay)
      }
    }
  }

  throw lastError
}

export async function waitUntil(
  fn: () => Promise<boolean>,
  opts?: {interval?: number; timeout?: number},
): Promise<void> {
  const timeout = opts?.timeout ?? 10_000
  const interval = opts?.interval ?? 250
  const start = Date.now()

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return
    // eslint-disable-next-line no-await-in-loop
    await sleep(interval)
  }

  throw new Error(`waitUntil timed out after ${timeout}ms`)
}
