import {expect} from 'chai'

import {
  InvalidSettingValueError,
  SettingsValidator,
  UnknownSettingKeyError,
} from '../../../../src/server/infra/storage/settings-validator.js'

describe('SettingsValidator', () => {
  const validator = new SettingsValidator()

  describe('validateKey', () => {
    it('returns the descriptor for a known key', () => {
      const descriptor = validator.validateKey('agentPool.maxSize')
      expect(descriptor.key).to.equal('agentPool.maxSize')
      expect(descriptor.type).to.equal('integer')
      expect(descriptor.default).to.be.a('number')
      expect(descriptor.min).to.be.a('number')
      expect(descriptor.max).to.be.a('number')
    })

    it('throws UnknownSettingKeyError for an unknown key', () => {
      expect(() => validator.validateKey('not.a.real.key')).to.throw(UnknownSettingKeyError)
    })

    it('includes the offending key on the error', () => {
      try {
        validator.validateKey('not.a.real.key')
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(UnknownSettingKeyError)
        if (error instanceof UnknownSettingKeyError) {
          expect(error.key).to.equal('not.a.real.key')
          expect(error.message).to.include('not.a.real.key')
        }
      }
    })
  })

  describe('validate', () => {
    it('returns the value when within range', () => {
      const result = validator.validate('agentPool.maxSize', 20)
      expect(result).to.equal(20)
    })

    it('throws UnknownSettingKeyError for an unknown key', () => {
      expect(() => validator.validate('nope', 1)).to.throw(UnknownSettingKeyError)
    })

    it('throws InvalidSettingValueError when value is not a number', () => {
      expect(() => validator.validate('agentPool.maxSize', 'twenty')).to.throw(
        InvalidSettingValueError,
      )
    })

    it('throws InvalidSettingValueError when value is a fractional number', () => {
      expect(() => validator.validate('agentPool.maxSize', 1.5)).to.throw(InvalidSettingValueError)
    })

    it('throws InvalidSettingValueError when value is below min', () => {
      try {
        validator.validate('agentPool.maxSize', 0)
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(InvalidSettingValueError)
        if (error instanceof InvalidSettingValueError) {
          expect(error.key).to.equal('agentPool.maxSize')
          expect(error.value).to.equal(0)
          expect(error.message).to.match(/range|min|max/i)
        }
      }
    })

    it('throws InvalidSettingValueError when value is above max', () => {
      const descriptor = validator.validateKey('agentPool.maxSize')
      expect(() => validator.validate('agentPool.maxSize', descriptor.max + 1)).to.throw(
        InvalidSettingValueError,
      )
    })

    it('accepts the minimum boundary value', () => {
      const descriptor = validator.validateKey('agentPool.maxSize')
      expect(validator.validate('agentPool.maxSize', descriptor.min)).to.equal(descriptor.min)
    })

    it('accepts the maximum boundary value', () => {
      const descriptor = validator.validateKey('agentPool.maxSize')
      expect(validator.validate('agentPool.maxSize', descriptor.max)).to.equal(descriptor.max)
    })

    it('validates each registered key independently', () => {
      expect(validator.validate('agentPool.maxConcurrentTasksPerProject', 3)).to.equal(3)
      expect(validator.validate('taskHistory.maxEntries', 5000)).to.equal(5000)
    })

    it('accepts llm.iterationBudgetMs within the documented 60_000 to 7_200_000 ms range', () => {
      expect(validator.validate('llm.iterationBudgetMs', 60_000)).to.equal(60_000)
      expect(validator.validate('llm.iterationBudgetMs', 1_800_000)).to.equal(1_800_000)
      expect(validator.validate('llm.iterationBudgetMs', 7_200_000)).to.equal(7_200_000)
    })

    it('rejects llm.iterationBudgetMs below the 60_000 ms minimum', () => {
      expect(() => validator.validate('llm.iterationBudgetMs', 30_000)).to.throw(InvalidSettingValueError)
    })

    it('rejects llm.iterationBudgetMs above the 7_200_000 ms maximum', () => {
      expect(() => validator.validate('llm.iterationBudgetMs', 7_200_001)).to.throw(InvalidSettingValueError)
    })

    it('names the key and the expected range on llm.iterationBudgetMs validation failure', () => {
      try {
        validator.validate('llm.iterationBudgetMs', 1)
        expect.fail('expected throw')
      } catch (error) {
        expect(error).to.be.instanceOf(InvalidSettingValueError)
        if (error instanceof InvalidSettingValueError) {
          expect(error.key).to.equal('llm.iterationBudgetMs')
          expect(error.message).to.include('60000')
          expect(error.message).to.include('7200000')
        }
      }
    })
  })

  describe('partition', () => {
    it('separates valid entries from invalid entries', () => {
      const result = validator.partition({
        'agentPool.maxConcurrentTasksPerProject': 'bad',
        'agentPool.maxSize': 25,
        'not.a.key': 7,
        'taskHistory.maxEntries': 5000,
      })

      expect(result.valid).to.deep.equal({
        'agentPool.maxSize': 25,
        'taskHistory.maxEntries': 5000,
      })
      expect(result.invalid).to.have.lengthOf(2)
      const keys = result.invalid.map((i) => i.key).sort()
      expect(keys).to.deep.equal(['agentPool.maxConcurrentTasksPerProject', 'not.a.key'])
    })

    it('returns empty valid/invalid for an empty record', () => {
      const result = validator.partition({})
      expect(result.valid).to.deep.equal({})
      expect(result.invalid).to.deep.equal([])
    })

    it('treats out-of-range values as invalid', () => {
      const result = validator.partition({'agentPool.maxSize': 0})
      expect(result.valid).to.deep.equal({})
      expect(result.invalid).to.have.lengthOf(1)
      expect(result.invalid[0].key).to.equal('agentPool.maxSize')
      expect(result.invalid[0].value).to.equal(0)
    })
  })
})
