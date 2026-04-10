import {expect} from 'chai'

import {parseFrontmatter} from '../../../../src/agent/infra/swarm/frontmatter.js'

describe('parseFrontmatter', () => {
  it('should parse valid frontmatter and body', () => {
    const content = '---\nname: test\nvalue: 42\n---\nThis is the body.'
    const result = parseFrontmatter<{name: string; value: number}>(content)

    expect(result).to.not.be.null
    expect(result!.frontmatter.name).to.equal('test')
    expect(result!.frontmatter.value).to.equal(42)
    expect(result!.body).to.equal('This is the body.')
  })

  it('should return body after closing delimiter with leading newline trimmed', () => {
    const content = '---\nkey: val\n---\n\nLine one.\nLine two.'
    const result = parseFrontmatter(content)

    expect(result).to.not.be.null
    expect(result!.body).to.equal('\nLine one.\nLine two.')
  })

  it('should return empty body when nothing follows closing delimiter', () => {
    const content = '---\nkey: val\n---\n'
    const result = parseFrontmatter(content)

    expect(result).to.not.be.null
    expect(result!.body).to.equal('')
  })

  it('should return null when content does not start with ---', () => {
    const content = 'no frontmatter here\n---\nkey: val\n---'
    const result = parseFrontmatter(content)

    expect(result).to.be.null
  })

  it('should return null when closing --- is missing', () => {
    const content = '---\nkey: val\nno closing delimiter'
    const result = parseFrontmatter(content)

    expect(result).to.be.null
  })

  it('should handle CRLF line endings', () => {
    const content = '---\r\nname: crlf\r\n---\r\nBody with CRLF.'
    const result = parseFrontmatter<{name: string}>(content)

    expect(result).to.not.be.null
    expect(result!.frontmatter.name).to.equal('crlf')
    expect(result!.body).to.equal('Body with CRLF.')
  })

  it('should return null on YAML parse errors', () => {
    const content = '---\n: invalid: yaml: {{{\n---\nBody.'
    const result = parseFrontmatter(content)

    expect(result).to.be.null
  })

  it('should return null when frontmatter is not an object', () => {
    const content = '---\njust a string\n---\nBody.'
    const result = parseFrontmatter(content)

    expect(result).to.be.null
  })
})
