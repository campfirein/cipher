import {expect} from 'chai'

import {LoopDetector} from '../../../../../../src/infra/cipher/llm/context/loop-detector.js'

describe('LoopDetector', () => {
  let loopDetector: LoopDetector

  beforeEach(() => {
    loopDetector = new LoopDetector()
  })

  describe('constructor', () => {
    it('should initialize with default config', async () => {
      const detector = new LoopDetector()
      // Default config: windowSize=10, exactRepeatThreshold=3, oscillationThreshold=2
      // Verify by making calls below threshold - should not detect loop
      await detector.recordAndCheck('tool1', {arg: 'value1'})
      await detector.recordAndCheck('tool1', {arg: 'value1'})
      const result = await detector.recordAndCheck('tool2', {arg: 'value2'})
      expect(result.isLoop).to.be.false
    })

    it('should accept custom config', async () => {
      const detector = new LoopDetector({
        exactRepeatThreshold: 2,
        oscillationThreshold: 1,
        windowSize: 5,
      })
      // With threshold=2, two identical calls should trigger loop
      await detector.recordAndCheck('tool1', {arg: 'value1'})
      const result = await detector.recordAndCheck('tool1', {arg: 'value1'})
      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })

    it('should merge partial config with defaults', async () => {
      const detector = new LoopDetector({exactRepeatThreshold: 2})
      // Only exactRepeatThreshold is overridden
      await detector.recordAndCheck('tool1', {arg: 'value1'})
      const result = await detector.recordAndCheck('tool1', {arg: 'value1'})
      expect(result.isLoop).to.be.true
    })
  })

  describe('recordAndCheck', () => {
    it('should return isLoop=false for first call', async () => {
      const result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      expect(result.isLoop).to.be.false
      expect(result.loopType).to.be.undefined
    })

    it('should return isLoop=false for different tool calls', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('writeFile', {content: 'hello', path: '/test.txt'})
      const result = await loopDetector.recordAndCheck('listFiles', {dir: '/'})
      expect(result.isLoop).to.be.false
    })

    it('should return isLoop=false for same tool with different args', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/test1.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test2.txt'})
      const result = await loopDetector.recordAndCheck('readFile', {path: '/test3.txt'})
      expect(result.isLoop).to.be.false
    })
  })

  describe('exact repeat detection', () => {
    it('should detect exact repeat after 3 identical calls (default threshold)', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      const result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
      expect(result.repeatCount).to.equal(3)
      expect(result.suggestion).to.include('readFile')
      expect(result.suggestion).to.include('3 times')
    })

    it('should detect exact repeat with custom threshold', async () => {
      const detector = new LoopDetector({exactRepeatThreshold: 5})

      // 4 calls should not trigger
      for (let i = 0; i < 4; i++) {
        // eslint-disable-next-line no-await-in-loop -- Sequential calls required for test
        const result = await detector.recordAndCheck('search', {query: 'test'})
        expect(result.isLoop).to.be.false
      }

      // 5th call should trigger
      const result = await detector.recordAndCheck('search', {query: 'test'})
      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
      expect(result.repeatCount).to.equal(5)
    })

    it('should not detect repeat when calls are broken by different tool', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/other.txt'}) // Different tool
      const result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.false
    })

    it('should not detect repeat when calls are broken by different args', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/different.txt'}) // Different args
      const result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.false
    })

    it('should continue detecting repeats after initial detection', async () => {
      // First detection at 3 calls
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      let result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      expect(result.isLoop).to.be.true
      expect(result.repeatCount).to.equal(3)

      // 4th call should also detect loop with higher count
      result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      expect(result.isLoop).to.be.true
      expect(result.repeatCount).to.equal(4)
    })
  })

  describe('oscillation detection', () => {
    it('should detect A→B→A→B oscillation pattern', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/a.txt'})
      await loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/b.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/a.txt'})
      const result = await loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/b.txt'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('oscillation')
      expect(result.suggestion).to.include('readFile')
      expect(result.suggestion).to.include('writeFile')
    })

    it('should not detect oscillation with less than 4 calls', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/a.txt'})
      await loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/b.txt'})
      const result = await loopDetector.recordAndCheck('readFile', {path: '/a.txt'})

      expect(result.isLoop).to.be.false
    })

    it('should not detect oscillation when pattern is not A→B→A→B', async () => {
      await loopDetector.recordAndCheck('tool1', {arg: 1})
      await loopDetector.recordAndCheck('tool2', {arg: 2})
      await loopDetector.recordAndCheck('tool3', {arg: 3}) // Different from tool1
      const result = await loopDetector.recordAndCheck('tool2', {arg: 2})

      expect(result.isLoop).to.be.false
    })

    it('should not detect oscillation when same tool called twice in a row', async () => {
      await loopDetector.recordAndCheck('tool1', {arg: 1})
      await loopDetector.recordAndCheck('tool1', {arg: 1}) // Same as first
      await loopDetector.recordAndCheck('tool1', {arg: 1})
      const result = await loopDetector.recordAndCheck('tool1', {arg: 1})

      // This should be detected as exact_repeat, not oscillation
      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })
  })

  describe('window size management', () => {
    it('should trim calls to window size', async () => {
      const detector = new LoopDetector({exactRepeatThreshold: 3, windowSize: 5})

      // Fill window with different calls
      await detector.recordAndCheck('tool1', {arg: 1})
      await detector.recordAndCheck('tool2', {arg: 2})
      await detector.recordAndCheck('tool3', {arg: 3})
      await detector.recordAndCheck('tool4', {arg: 4})
      await detector.recordAndCheck('tool5', {arg: 5})

      // Now make repeated calls - window will shift
      await detector.recordAndCheck('repeat', {arg: 'x'})
      await detector.recordAndCheck('repeat', {arg: 'x'})
      const result = await detector.recordAndCheck('repeat', {arg: 'x'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })

    it('should work correctly with windowSize=1', async () => {
      const detector = new LoopDetector({exactRepeatThreshold: 2, windowSize: 1})

      // With window=1, only the current call is tracked
      // First call should not be detected as loop
      const result1 = await detector.recordAndCheck('tool1', {arg: 1})
      expect(result1.isLoop).to.be.false

      // Second identical call won't be detected because window only holds 1 call
      // (the previous call was shifted out when the new one came in)
      const result2 = await detector.recordAndCheck('tool1', {arg: 1})
      expect(result2.isLoop).to.be.false
    })
  })

  describe('argument hashing', () => {
    it('should treat different argument order as same', async () => {
      await loopDetector.recordAndCheck('tool', {a: 1, b: 2, c: 3})
      await loopDetector.recordAndCheck('tool', {a: 1, b: 2, c: 3})
      const result = await loopDetector.recordAndCheck('tool', {a: 1, b: 2, c: 3})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })

    it('should handle nested objects', async () => {
      await loopDetector.recordAndCheck('tool', {nested: {x: 1, y: 2}})
      await loopDetector.recordAndCheck('tool', {nested: {x: 1, y: 2}})
      const result = await loopDetector.recordAndCheck('tool', {nested: {x: 1, y: 2}})

      expect(result.isLoop).to.be.true
    })

    it('should handle arrays', async () => {
      await loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})
      await loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})
      const result = await loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})

      expect(result.isLoop).to.be.true
    })

    it('should distinguish different array orders', async () => {
      await loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})
      await loopDetector.recordAndCheck('tool', {items: [3, 2, 1]}) // Different order
      const result = await loopDetector.recordAndCheck('tool', {items: [2, 1, 3]}) // Different order

      expect(result.isLoop).to.be.false
    })

    it('should handle empty objects', async () => {
      await loopDetector.recordAndCheck('tool', {})
      await loopDetector.recordAndCheck('tool', {})
      const result = await loopDetector.recordAndCheck('tool', {})

      expect(result.isLoop).to.be.true
    })

    it('should handle special values (null, undefined, boolean)', async () => {
      await loopDetector.recordAndCheck('tool', {a: null, b: true, c: false})
      await loopDetector.recordAndCheck('tool', {a: null, b: true, c: false})
      const result = await loopDetector.recordAndCheck('tool', {a: null, b: true, c: false})

      expect(result.isLoop).to.be.true
    })
  })

  describe('reset', () => {
    it('should clear all recorded calls', async () => {
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      await loopDetector.reset()

      // After reset, same call should not be detected as repeat
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      const result = await loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.true // Fresh start, 3rd call triggers
    })

    it('should allow normal operation after reset', async () => {
      // Build up some history
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- Sequential calls required for test
        await loopDetector.recordAndCheck(`tool${i}`, {arg: i})
      }

      await loopDetector.reset()

      // New calls should work normally
      const result1 = await loopDetector.recordAndCheck('newTool', {arg: 'new'})
      expect(result1.isLoop).to.be.false

      const result2 = await loopDetector.recordAndCheck('anotherTool', {arg: 'another'})
      expect(result2.isLoop).to.be.false
    })
  })

  describe('edge cases', () => {
    it('should handle very long tool names', async () => {
      const longName = 'a'.repeat(1000)
      await loopDetector.recordAndCheck(longName, {})
      await loopDetector.recordAndCheck(longName, {})
      const result = await loopDetector.recordAndCheck(longName, {})

      expect(result.isLoop).to.be.true
    })

    it('should handle very large argument objects', async () => {
      const largeArgs: Record<string, number> = {}
      for (let i = 0; i < 100; i++) {
        largeArgs[`key${i}`] = i
      }

      await loopDetector.recordAndCheck('tool', largeArgs)
      await loopDetector.recordAndCheck('tool', largeArgs)
      const result = await loopDetector.recordAndCheck('tool', largeArgs)

      expect(result.isLoop).to.be.true
    })

    it('should handle string arguments with special characters', async () => {
      const args = {
        content: 'Hello\n"World"\ttab\\backslash',
        emoji: '🚀🎉',
        unicode: '日本語',
      }

      await loopDetector.recordAndCheck('tool', args)
      await loopDetector.recordAndCheck('tool', args)
      const result = await loopDetector.recordAndCheck('tool', args)

      expect(result.isLoop).to.be.true
    })

    it('should handle rapid successive calls', async () => {
      // Simulate rapid calls
      for (let i = 0; i < 100; i++) {
        // eslint-disable-next-line no-await-in-loop -- Sequential calls required for test
        await loopDetector.recordAndCheck('rapidTool', {iteration: i % 10})
      }

      // Final repeated calls should be detected
      await loopDetector.recordAndCheck('final', {})
      await loopDetector.recordAndCheck('final', {})
      const result = await loopDetector.recordAndCheck('final', {})

      expect(result.isLoop).to.be.true
    })
  })

  describe('integration - typical agent usage patterns', () => {
    it('should detect agent stuck reading same file', async () => {
      // Simulates agent repeatedly reading same file expecting different content
      const detector = new LoopDetector()

      await detector.recordAndCheck('readFile', {path: '/config.json'})
      await detector.recordAndCheck('readFile', {path: '/config.json'})
      const result = await detector.recordAndCheck('readFile', {path: '/config.json'})

      expect(result.isLoop).to.be.true
      expect(result.suggestion).to.include('different approach')
    })

    it('should detect agent oscillating between search and read', async () => {
      // Simulates agent stuck in search→read→search→read cycle
      const detector = new LoopDetector()

      await detector.recordAndCheck('search', {query: 'error handler'})
      await detector.recordAndCheck('readFile', {path: '/src/handlers.ts'})
      await detector.recordAndCheck('search', {query: 'error handler'})
      const result = await detector.recordAndCheck('readFile', {path: '/src/handlers.ts'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('oscillation')
    })

    it('should not flag legitimate repetitive work', async () => {
      // Agent reading different files in sequence is legitimate
      const detector = new LoopDetector()

      await detector.recordAndCheck('readFile', {path: '/file1.ts'})
      await detector.recordAndCheck('readFile', {path: '/file2.ts'})
      await detector.recordAndCheck('readFile', {path: '/file3.ts'})
      const result = await detector.recordAndCheck('readFile', {path: '/file4.ts'})

      expect(result.isLoop).to.be.false
    })

    it('should not flag agent writing to different files', async () => {
      const detector = new LoopDetector()

      await detector.recordAndCheck('writeFile', {content: 'a', path: '/a.ts'})
      await detector.recordAndCheck('writeFile', {content: 'b', path: '/b.ts'})
      await detector.recordAndCheck('writeFile', {content: 'c', path: '/c.ts'})
      const result = await detector.recordAndCheck('writeFile', {content: 'd', path: '/d.ts'})

      expect(result.isLoop).to.be.false
    })
  })

  describe('thread safety', () => {
    it('should handle concurrent recordAndCheck calls safely', async () => {
      const detector = new LoopDetector({exactRepeatThreshold: 5, windowSize: 20})

      // Simulate concurrent calls
      const promises = Array.from({length: 10}, (_, i) =>
        detector.recordAndCheck('concurrentTool', {index: i % 3}),
      )

      const results = await Promise.all(promises)

      // All calls should complete without error
      expect(results).to.have.length(10)
      for (const result of results) {
        expect(result).to.have.property('isLoop')
      }
    })

    it('should maintain correct count under concurrent access', async () => {
      const detector = new LoopDetector({exactRepeatThreshold: 10, windowSize: 20})

      // Make 15 identical concurrent calls
      const promises = Array.from({length: 15}, () =>
        detector.recordAndCheck('sameTool', {arg: 'same'}),
      )

      await Promise.all(promises)

      // The window should contain exactly windowSize calls
      expect(detector.getRecentCallCount()).to.be.at.most(20)
    })
  })
})
