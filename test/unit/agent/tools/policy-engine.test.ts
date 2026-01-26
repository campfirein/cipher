import {expect} from 'chai'

import type {PolicyRule} from '../../../../src/agent/core/interfaces/i-policy-engine.js'

import {PolicyEngine} from '../../../../src/agent/infra/tools/policy-engine.js'

describe('PolicyEngine', () => {
  describe('constructor', () => {
    it('should create with default ALLOW decision', () => {
      const engine = new PolicyEngine()

      // With no rules, should use default decision
      const result = engine.evaluate('unknown_tool', {})

      expect(result.decision).to.equal('ALLOW')
      expect(result.reason).to.include('default')
    })

    it('should create with custom default DENY decision', () => {
      const engine = new PolicyEngine({defaultDecision: 'DENY'})

      const result = engine.evaluate('unknown_tool', {})

      expect(result.decision).to.equal('DENY')
    })
  })

  describe('addRule', () => {
    it('should add a single rule', () => {
      const engine = new PolicyEngine()
      const rule: PolicyRule = {
        decision: 'DENY',
        name: 'deny-dangerous',
        toolPattern: 'dangerous_tool',
      }

      engine.addRule(rule)

      expect(engine.getRules()).to.have.lengthOf(1)
      expect(engine.getRules()[0].name).to.equal('deny-dangerous')
    })

    it('should add multiple rules with addRules', () => {
      const engine = new PolicyEngine()
      const rules: PolicyRule[] = [
        {decision: 'ALLOW', name: 'allow-read', toolPattern: 'read_file'},
        {decision: 'DENY', name: 'deny-write', toolPattern: 'write_file'},
      ]

      engine.addRules(rules)

      expect(engine.getRules()).to.have.lengthOf(2)
    })
  })

  describe('removeRule', () => {
    it('should remove existing rule by name', () => {
      const engine = new PolicyEngine()
      engine.addRule({decision: 'DENY', name: 'test-rule', toolPattern: 'test'})

      engine.removeRule('test-rule')

      expect(engine.getRules()).to.have.lengthOf(0)
    })

    it('should not throw when rule not found', () => {
      const engine = new PolicyEngine()

      // Should not throw when removing non-existent rule
      expect(() => engine.removeRule('non-existent')).to.not.throw()
    })
  })

  describe('evaluate', () => {
    describe('string pattern matching', () => {
      it('should match exact tool name', () => {
        const engine = new PolicyEngine()
        engine.addRule({
          decision: 'DENY',
          name: 'deny-bash',
          reason: 'Bash execution blocked',
          toolPattern: 'bash_exec',
        })

        const result = engine.evaluate('bash_exec', {})

        expect(result.decision).to.equal('DENY')
        expect(result.reason).to.equal('Bash execution blocked')
        expect(result.rule?.name).to.equal('deny-bash')
      })

      it('should not match different tool name', () => {
        const engine = new PolicyEngine()
        engine.addRule({
          decision: 'DENY',
          name: 'deny-bash',
          toolPattern: 'bash_exec',
        })

        const result = engine.evaluate('read_file', {})

        expect(result.decision).to.equal('ALLOW') // Default
      })
    })

    describe('regex pattern matching', () => {
      it('should match tool name with regex', () => {
        const engine = new PolicyEngine()
        engine.addRule({
          decision: 'ALLOW',
          name: 'allow-read-tools',
          toolPattern: /^read_.*/,
        })

        expect(engine.evaluate('read_file', {}).decision).to.equal('ALLOW')
        expect(engine.evaluate('read_memory', {}).decision).to.equal('ALLOW')
      })

      it('should not match tool name that does not match regex', () => {
        const engine = new PolicyEngine({defaultDecision: 'DENY'})
        engine.addRule({
          decision: 'ALLOW',
          name: 'allow-read-tools',
          toolPattern: /^read_.*/,
        })

        expect(engine.evaluate('write_file', {}).decision).to.equal('DENY')
      })
    })

    describe('wildcard pattern matching', () => {
      it('should match all tools with * pattern', () => {
        const engine = new PolicyEngine({defaultDecision: 'DENY'})
        engine.addRule({
          decision: 'ALLOW',
          name: 'allow-all',
          toolPattern: '*',
        })

        expect(engine.evaluate('any_tool', {}).decision).to.equal('ALLOW')
        expect(engine.evaluate('another_tool', {}).decision).to.equal('ALLOW')
      })
    })

    describe('condition-based matching', () => {
      it('should apply condition function', () => {
        const engine = new PolicyEngine()
        engine.addRule({
          condition(_toolName, args) {
            const command = String(args.command || '')
            return command.includes('rm -rf /')
          },
          decision: 'DENY',
          name: 'deny-rm-rf-root',
          reason: 'Dangerous root deletion blocked',
          toolPattern: 'bash_exec',
        })

        // Should deny dangerous command
        const dangerousResult = engine.evaluate('bash_exec', {command: 'rm -rf /'})
        expect(dangerousResult.decision).to.equal('DENY')

        // Should allow safe command (falls through to default)
        const safeResult = engine.evaluate('bash_exec', {command: 'ls -la'})
        expect(safeResult.decision).to.equal('ALLOW')
      })

      it('should skip rule when condition returns false', () => {
        const engine = new PolicyEngine({defaultDecision: 'ALLOW'})
        engine.addRule({
          condition: () => false,
          decision: 'DENY',
          name: 'conditional-deny',
          toolPattern: 'bash_exec',
        })

        const result = engine.evaluate('bash_exec', {})

        expect(result.decision).to.equal('ALLOW') // Skipped to default
      })
    })

    describe('rule priority', () => {
      it('should apply first matching rule', () => {
        const engine = new PolicyEngine()
        engine.addRules([
          {decision: 'DENY', name: 'deny-specific', reason: 'Specific denial', toolPattern: 'bash_exec'},
          {decision: 'ALLOW', name: 'allow-all', reason: 'General allow', toolPattern: '*'},
        ])

        const result = engine.evaluate('bash_exec', {})

        expect(result.decision).to.equal('DENY')
        expect(result.rule?.name).to.equal('deny-specific')
      })

      it('should fall through to later rules if condition not met', () => {
        const engine = new PolicyEngine()
        engine.addRules([
          {
            condition: () => false,
            decision: 'DENY',
            name: 'conditional-deny',
            toolPattern: 'bash_exec',
          },
          {decision: 'ALLOW', name: 'allow-bash', reason: 'Bash allowed', toolPattern: 'bash_exec'},
        ])

        const result = engine.evaluate('bash_exec', {})

        expect(result.decision).to.equal('ALLOW')
        expect(result.rule?.name).to.equal('allow-bash')
      })
    })
  })

  describe('getRules', () => {
    it('should return readonly copy of rules', () => {
      const engine = new PolicyEngine()
      engine.addRule({decision: 'DENY', name: 'test', toolPattern: 'test'})

      const rules = engine.getRules()

      expect(rules).to.be.an('array')
      expect(rules).to.have.lengthOf(1)
    })
  })
})
