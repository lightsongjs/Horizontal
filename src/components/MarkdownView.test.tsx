import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from './MarkdownView'

const html = (text: string, toggle = true) =>
  renderToStaticMarkup(<MarkdownView text={text} prefixes={['HZ']} onToggle={toggle ? () => {} : undefined} onRef={() => {}} />)

describe('MarkdownView', () => {
  it('căsuța e un checkbox accesibil, cu rândul bifat marcat', () => {
    const h = html('- [x] gata\n- [ ] nu')
    expect(h).toContain('role="checkbox"')
    expect(h).toContain('aria-checked="true"')
    expect(h).toContain('class="md-li md-li-task done"')
  })
  it('fără onToggle căsuțele sunt dezactivate (fir, fără drept de scriere)', () => {
    expect(html('- [ ] a', false)).toContain('disabled=""')
  })
  it('linkurile se deschid în altă filă, fără opener', () => {
    expect(html('[x](https://a.ro)')).toContain('<a href="https://a.ro" target="_blank" rel="noopener noreferrer"')
  })
  it('HTML-ul brut e scăpat, nu interpretat', () => {
    expect(html('<img src=x onerror=alert(1)>')).not.toContain('<img')
  })
  it('separatorul e ⁂', () => expect(html('a\n\n---\n\nb')).toContain('⁂'))
  it('blocul de cod are buton de copiere în cutia lui (și în fir, fără onToggle)', () => {
    for (const h of [html('```bash\nnpm test\n```'), html('```\nx\n```', false)]) {
      expect(h).toMatch(/<div class="md-pre-box"><pre class="md-pre"><code>[^<]*<\/code><\/pre><button type="button" class="md-copy" aria-label="Copiază codul"/)
    }
    expect(html('`inline`')).not.toContain('md-copy')
  })
})
