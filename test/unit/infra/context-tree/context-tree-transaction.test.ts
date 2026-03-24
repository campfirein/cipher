import {expect} from 'chai'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ContextTreeTransaction} from '../../../../src/server/infra/context-tree/context-tree-transaction.js'

describe('ContextTreeTransaction', () => {
  let testDir: string
  let treeDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'brv-txn-'))
    treeDir = join(testDir, 'context-tree')
    mkdirSync(join(treeDir, 'domain'), {recursive: true})
    writeFileSync(join(treeDir, 'domain', 'entry.md'), '# Test Entry')
  })

  afterEach(() => { rmSync(testDir, {force: true, recursive: true}) })

  it('begin + commit: backup cleaned, tree intact', async () => {
    const txn = new ContextTreeTransaction({contextTreeDir: treeDir})
    await txn.begin()
    expect(existsSync(`${treeDir}-reorg-backup`)).to.be.true
    await txn.commit()
    expect(existsSync(`${treeDir}-reorg-backup`)).to.be.false
    expect(readFileSync(join(treeDir, 'domain', 'entry.md'), 'utf8')).to.equal('# Test Entry')
  })

  it('begin + rollback: tree restored', async () => {
    const txn = new ContextTreeTransaction({contextTreeDir: treeDir})
    await txn.begin()
    writeFileSync(join(treeDir, 'domain', 'entry.md'), '# Modified')
    await txn.rollback()
    expect(readFileSync(join(treeDir, 'domain', 'entry.md'), 'utf8')).to.equal('# Test Entry')
  })

  it('double begin throws', async () => {
    const txn = new ContextTreeTransaction({contextTreeDir: treeDir})
    await txn.begin()
    try {
      await txn.begin()
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.include('idle')
    }
  })

  it('commit without begin throws', async () => {
    const txn = new ContextTreeTransaction({contextTreeDir: treeDir})
    try {
      await txn.commit()
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.include('active')
    }
  })

  it('rollback after commit throws', async () => {
    const txn = new ContextTreeTransaction({contextTreeDir: treeDir})
    await txn.begin()
    await txn.commit()
    try {
      await txn.rollback()
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.include('active')
    }
  })
})
