import {expect} from 'chai'

import {buildVcRmCompletionMessage} from '../../../../../../src/tui/features/vc/rm/components/build-vc-rm-completion-message.js'

describe('buildVcRmCompletionMessage', () => {
  it('quiet=true: returns empty string regardless of perFile/summary content', () => {
    expect(
      buildVcRmCompletionMessage({filesRemoved: 3, perFile: ["rm 'a.md'", "rm 'b.md'", "rm 'c.md'"]}, {quiet: true}),
    ).to.equal('')

    expect(buildVcRmCompletionMessage({filesRemoved: 0, perFile: []}, {quiet: true})).to.equal('')

    expect(
      buildVcRmCompletionMessage({dryRun: true, filesRemoved: 1, perFile: ["rm 'a.md'"]}, {quiet: true}),
    ).to.equal('')
  })

  it('quiet=false, success: per-file lines + "Removed N file(s)." summary', () => {
    expect(
      buildVcRmCompletionMessage({filesRemoved: 2, perFile: ["rm 'a.md'", "rm 'b.md'"]}, {quiet: false}),
    ).to.equal("rm 'a.md'\nrm 'b.md'\nRemoved 2 file(s).")
  })

  it('quiet=false, no files removed: "Nothing to remove." summary only', () => {
    expect(buildVcRmCompletionMessage({filesRemoved: 0, perFile: []}, {quiet: false})).to.equal('Nothing to remove.')
  })

  it('quiet=false, dryRun: "Would remove N file(s)." summary mirroring git rm -n', () => {
    expect(
      buildVcRmCompletionMessage(
        {dryRun: true, filesRemoved: 2, perFile: ["rm 'a.md'", "rm 'b.md'"]},
        {quiet: false},
      ),
    ).to.equal("rm 'a.md'\nrm 'b.md'\nWould remove 2 file(s).")
  })

  it('quiet undefined: treated as quiet=false', () => {
    expect(buildVcRmCompletionMessage({filesRemoved: 1, perFile: ["rm 'a.md'"]}, {})).to.equal(
      "rm 'a.md'\nRemoved 1 file(s).",
    )
  })
})
