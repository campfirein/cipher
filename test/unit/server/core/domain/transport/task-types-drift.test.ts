 
import {expect} from 'chai'

import {type TaskType as ServerTaskType, TaskTypeSchema} from '../../../../../../src/server/core/domain/transport/schemas.js'
import {type TaskType as SharedTaskType, TASK_TYPE_VALUES, TaskTypes} from '../../../../../../src/shared/analytics/task-types.js'

/**
 * Compile-time bidirectional check: if either side drifts (a daemon contributor
 * adds a new value to the server-side TaskTypeSchema, or a refactor removes one
 * from the shared TaskTypes enum), one of the assertions below fails to type-check.
 *
 * Without this, M2.8's task_* event schemas would silently reject the new task
 * type at emit time, and the failure would only surface as missing analytics —
 * not a build error.
 */
type _AssertSharedExtendsServer = SharedTaskType extends ServerTaskType ? true : never
type _AssertServerExtendsShared = ServerTaskType extends SharedTaskType ? true : never

const _bothDirections: [_AssertSharedExtendsServer, _AssertServerExtendsShared] = [true, true]

describe('TaskType ↔ TaskTypes drift detection', () => {
  it('should mention the compile-time guard so the file is not pruned', () => {
    expect(_bothDirections).to.deep.equal([true, true])
  })

  it('should agree at runtime: TaskTypeSchema.options matches Object.values(TaskTypes)', () => {
    expect([...TaskTypeSchema.options].sort()).to.deep.equal(Object.values(TaskTypes).sort())
  })

  it('should agree at runtime: TASK_TYPE_VALUES matches TaskTypeSchema.options', () => {
    expect([...TASK_TYPE_VALUES].sort()).to.deep.equal([...TaskTypeSchema.options].sort())
  })
})
