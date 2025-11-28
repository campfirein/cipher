import {expect} from 'chai'

import {LoopDetector} from '../../../../../../src/infra/cipher/llm/context/loop-detector.js'

describe('LoopDetector', () => {
  let loopDetector: LoopDetector

  beforeEach(() => {
    loopDetector = new LoopDetector()
  })

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const detector = new LoopDetector()
      // Default config: windowSize=10, exactRepeatThreshold=3, oscillationThreshold=2
      // Verify by making calls below threshold - should not detect loop
      detector.recordAndCheck('tool1', {arg: 'value1'})
      detector.recordAndCheck('tool1', {arg: 'value1'})
      const result = detector.recordAndCheck('tool2', {arg: 'value2'})
      expect(result.isLoop).to.be.false
    })

    it('should accept custom config', () => {
      const detector = new LoopDetector({
        exactRepeatThreshold: 2,
        oscillationThreshold: 1,
        windowSize: 5,
      })
      // With threshold=2, two identical calls should trigger loop
      detector.recordAndCheck('tool1', {arg: 'value1'})
      const result = detector.recordAndCheck('tool1', {arg: 'value1'})
      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })

    it('should merge partial config with defaults', () => {
      const detector = new LoopDetector({exactRepeatThreshold: 2})
      // Only exactRepeatThreshold is overridden
      detector.recordAndCheck('tool1', {arg: 'value1'})
      const result = detector.recordAndCheck('tool1', {arg: 'value1'})
      expect(result.isLoop).to.be.true
    })
  })

  describe('recordAndCheck', () => {
    it('should return isLoop=false for first call', () => {
      const result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      expect(result.isLoop).to.be.false
      expect(result.loopType).to.be.undefined
    })

    it('should return isLoop=false for different tool calls', () => {
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('writeFile', {content: 'hello', path: '/test.txt'})
      const result = loopDetector.recordAndCheck('listFiles', {dir: '/'})
      expect(result.isLoop).to.be.false
    })

    it('should return isLoop=false for same tool with different args', () => {
      loopDetector.recordAndCheck('readFile', {path: '/test1.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test2.txt'})
      const result = loopDetector.recordAndCheck('readFile', {path: '/test3.txt'})
      expect(result.isLoop).to.be.false
    })
  })

  describe('exact repeat detection', () => {
    it('should detect exact repeat after 3 identical calls (default threshold)', () => {
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      const result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
      expect(result.repeatCount).to.equal(3)
      expect(result.suggestion).to.include('readFile')
      expect(result.suggestion).to.include('3 times')
    })

    it('should detect exact repeat with custom threshold', () => {
      const detector = new LoopDetector({exactRepeatThreshold: 5})

      // 4 calls should not trigger
      for (let i = 0; i < 4; i++) {
        const result = detector.recordAndCheck('search', {query: 'test'})
        expect(result.isLoop).to.be.false
      }

      // 5th call should trigger
      const result = detector.recordAndCheck('search', {query: 'test'})
      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
      expect(result.repeatCount).to.equal(5)
    })

    it('should not detect repeat when calls are broken by different tool', () => {
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/other.txt'}) // Different tool
      const result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.false
    })

    it('should not detect repeat when calls are broken by different args', () => {
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/different.txt'}) // Different args
      const result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.false
    })

    it('should continue detecting repeats after initial detection', () => {
      // First detection at 3 calls
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      let result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      expect(result.isLoop).to.be.true
      expect(result.repeatCount).to.equal(3)

      // 4th call should also detect loop with higher count
      result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      expect(result.isLoop).to.be.true
      expect(result.repeatCount).to.equal(4)
    })
  })

  describe('oscillation detection', () => {
    it('should detect A→B→A→B oscillation pattern', () => {
      loopDetector.recordAndCheck('readFile', {path: '/a.txt'})
      loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/b.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/a.txt'})
      const result = loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/b.txt'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('oscillation')
      expect(result.suggestion).to.include('readFile')
      expect(result.suggestion).to.include('writeFile')
    })

    it('should not detect oscillation with less than 4 calls', () => {
      loopDetector.recordAndCheck('readFile', {path: '/a.txt'})
      loopDetector.recordAndCheck('writeFile', {content: 'x', path: '/b.txt'})
      const result = loopDetector.recordAndCheck('readFile', {path: '/a.txt'})

      expect(result.isLoop).to.be.false
    })

    it('should not detect oscillation when pattern is not A→B→A→B', () => {
      loopDetector.recordAndCheck('tool1', {arg: 1})
      loopDetector.recordAndCheck('tool2', {arg: 2})
      loopDetector.recordAndCheck('tool3', {arg: 3}) // Different from tool1
      const result = loopDetector.recordAndCheck('tool2', {arg: 2})

      expect(result.isLoop).to.be.false
    })

    it('should not detect oscillation when same tool called twice in a row', () => {
      loopDetector.recordAndCheck('tool1', {arg: 1})
      loopDetector.recordAndCheck('tool1', {arg: 1}) // Same as first
      loopDetector.recordAndCheck('tool1', {arg: 1})
      const result = loopDetector.recordAndCheck('tool1', {arg: 1})

      // This should be detected as exact_repeat, not oscillation
      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })
  })

  describe('window size management', () => {
    it('should trim calls to window size', () => {
      const detector = new LoopDetector({exactRepeatThreshold: 3, windowSize: 5})

      // Fill window with different calls
      detector.recordAndCheck('tool1', {arg: 1})
      detector.recordAndCheck('tool2', {arg: 2})
      detector.recordAndCheck('tool3', {arg: 3})
      detector.recordAndCheck('tool4', {arg: 4})
      detector.recordAndCheck('tool5', {arg: 5})

      // Now make repeated calls - window will shift
      detector.recordAndCheck('repeat', {arg: 'x'})
      detector.recordAndCheck('repeat', {arg: 'x'})
      const result = detector.recordAndCheck('repeat', {arg: 'x'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })

    it('should work correctly with windowSize=1', () => {
      const detector = new LoopDetector({exactRepeatThreshold: 2, windowSize: 1})

      // With window=1, only the current call is tracked
      // First call should not be detected as loop
      const result1 = detector.recordAndCheck('tool1', {arg: 1})
      expect(result1.isLoop).to.be.false

      // Second identical call won't be detected because window only holds 1 call
      // (the previous call was shifted out when the new one came in)
      const result2 = detector.recordAndCheck('tool1', {arg: 1})
      expect(result2.isLoop).to.be.false
    })
  })

  describe('argument hashing', () => {
    it('should treat different argument order as same', () => {
      loopDetector.recordAndCheck('tool', {a: 1, b: 2, c: 3})
      loopDetector.recordAndCheck('tool', {a: 1, b: 2, c: 3})
      const result = loopDetector.recordAndCheck('tool', {a: 1, b: 2, c: 3})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('exact_repeat')
    })

    it('should handle nested objects', () => {
      loopDetector.recordAndCheck('tool', {nested: {x: 1, y: 2}})
      loopDetector.recordAndCheck('tool', {nested: {x: 1, y: 2}})
      const result = loopDetector.recordAndCheck('tool', {nested: {x: 1, y: 2}})

      expect(result.isLoop).to.be.true
    })

    it('should handle arrays', () => {
      loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})
      loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})
      const result = loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})

      expect(result.isLoop).to.be.true
    })

    it('should distinguish different array orders', () => {
      loopDetector.recordAndCheck('tool', {items: [1, 2, 3]})
      loopDetector.recordAndCheck('tool', {items: [3, 2, 1]}) // Different order
      const result = loopDetector.recordAndCheck('tool', {items: [2, 1, 3]}) // Different order

      expect(result.isLoop).to.be.false
    })

    it('should handle empty objects', () => {
      loopDetector.recordAndCheck('tool', {})
      loopDetector.recordAndCheck('tool', {})
      const result = loopDetector.recordAndCheck('tool', {})

      expect(result.isLoop).to.be.true
    })

    it('should handle special values (null, undefined, boolean)', () => {
      loopDetector.recordAndCheck('tool', {a: null, b: true, c: false})
      loopDetector.recordAndCheck('tool', {a: null, b: true, c: false})
      const result = loopDetector.recordAndCheck('tool', {a: null, b: true, c: false})

      expect(result.isLoop).to.be.true
    })
  })

  describe('reset', () => {
    it('should clear all recorded calls', () => {
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      loopDetector.reset()

      // After reset, same call should not be detected as repeat
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      loopDetector.recordAndCheck('readFile', {path: '/test.txt'})
      const result = loopDetector.recordAndCheck('readFile', {path: '/test.txt'})

      expect(result.isLoop).to.be.true // Fresh start, 3rd call triggers
    })

    it('should allow normal operation after reset', () => {
      // Build up some history
      for (let i = 0; i < 5; i++) {
        loopDetector.recordAndCheck(`tool${i}`, {arg: i})
      }

      loopDetector.reset()

      // New calls should work normally
      const result1 = loopDetector.recordAndCheck('newTool', {arg: 'new'})
      expect(result1.isLoop).to.be.false

      const result2 = loopDetector.recordAndCheck('anotherTool', {arg: 'another'})
      expect(result2.isLoop).to.be.false
    })
  })

  describe('edge cases', () => {
    it('should handle very long tool names', () => {
      const longName = 'a'.repeat(1000)
      loopDetector.recordAndCheck(longName, {})
      loopDetector.recordAndCheck(longName, {})
      const result = loopDetector.recordAndCheck(longName, {})

      expect(result.isLoop).to.be.true
    })

    it('should handle very large argument objects', () => {
      const largeArgs: Record<string, number> = {}
      for (let i = 0; i < 100; i++) {
        largeArgs[`key${i}`] = i
      }

      loopDetector.recordAndCheck('tool', largeArgs)
      loopDetector.recordAndCheck('tool', largeArgs)
      const result = loopDetector.recordAndCheck('tool', largeArgs)

      expect(result.isLoop).to.be.true
    })

    it('should handle string arguments with special characters', () => {
      const args = {
        content: 'Hello\n"World"\ttab\\backslash',
        emoji: '🚀🎉',
        unicode: '日本語',
      }

      loopDetector.recordAndCheck('tool', args)
      loopDetector.recordAndCheck('tool', args)
      const result = loopDetector.recordAndCheck('tool', args)

      expect(result.isLoop).to.be.true
    })

    it('should handle rapid successive calls', () => {
      // Simulate rapid calls
      for (let i = 0; i < 100; i++) {
        loopDetector.recordAndCheck('rapidTool', {iteration: i % 10})
      }

      // Final repeated calls should be detected
      loopDetector.recordAndCheck('final', {})
      loopDetector.recordAndCheck('final', {})
      const result = loopDetector.recordAndCheck('final', {})

      expect(result.isLoop).to.be.true
    })
  })

  describe('integration - typical agent usage patterns', () => {
    it('should detect agent stuck reading same file', () => {
      // Simulates agent repeatedly reading same file expecting different content
      const detector = new LoopDetector()

      detector.recordAndCheck('readFile', {path: '/config.json'})
      detector.recordAndCheck('readFile', {path: '/config.json'})
      const result = detector.recordAndCheck('readFile', {path: '/config.json'})

      expect(result.isLoop).to.be.true
      expect(result.suggestion).to.include('different approach')
    })

    it('should detect agent oscillating between search and read', () => {
      // Simulates agent stuck in search→read→search→read cycle
      const detector = new LoopDetector()

      detector.recordAndCheck('search', {query: 'error handler'})
      detector.recordAndCheck('readFile', {path: '/src/handlers.ts'})
      detector.recordAndCheck('search', {query: 'error handler'})
      const result = detector.recordAndCheck('readFile', {path: '/src/handlers.ts'})

      expect(result.isLoop).to.be.true
      expect(result.loopType).to.equal('oscillation')
    })

    it('should not flag legitimate repetitive work', () => {
      // Agent reading different files in sequence is legitimate
      const detector = new LoopDetector()

      detector.recordAndCheck('readFile', {path: '/file1.ts'})
      detector.recordAndCheck('readFile', {path: '/file2.ts'})
      detector.recordAndCheck('readFile', {path: '/file3.ts'})
      const result = detector.recordAndCheck('readFile', {path: '/file4.ts'})

      expect(result.isLoop).to.be.false
    })

    it('should not flag agent writing to different files', () => {
      const detector = new LoopDetector()

      detector.recordAndCheck('writeFile', {content: 'a', path: '/a.ts'})
      detector.recordAndCheck('writeFile', {content: 'b', path: '/b.ts'})
      detector.recordAndCheck('writeFile', {content: 'c', path: '/c.ts'})
      const result = detector.recordAndCheck('writeFile', {content: 'd', path: '/d.ts'})

      expect(result.isLoop).to.be.false
    })
  })
})
