import { describe, it, expect } from 'vitest'
import {
  MAX_FILES, MAX_FILE_BYTES, MAX_REQUEST_BYTES, checkFiles, decodeBase64, filesFromJson, resolveContentType,
  type IncomingFile,
} from './_attachments-lib'

const file = (filename: string, size: number): IncomingFile =>
  ({ filename, contentType: '', bytes: new Uint8Array(size) })

describe('resolveContentType', () => {
  it('keeps a meaningful declared type, without parameters', () => {
    expect(resolveContentType('image/PNG; charset=binary', 'x.bin')).toBe('image/png')
  })
  it('guesses from the extension when the client said nothing or octet-stream', () => {
    expect(resolveContentType('', 'poza.JPG')).toBe('image/jpeg')
    expect(resolveContentType('application/octet-stream', 'ecran.png')).toBe('image/png')
    expect(resolveContentType(null, 'raport.pdf')).toBe('application/pdf')
  })
  it('falls back to octet-stream for unknown extensions', () => {
    expect(resolveContentType('', 'arhiva.xyz')).toBe('application/octet-stream')
    expect(resolveContentType(undefined, 'fara-extensie')).toBe('application/octet-stream')
  })
})

describe('checkFiles', () => {
  it('accepts a normal batch', () => {
    expect(checkFiles([file('a.png', 10), file('b.png', 20)])).toBeNull()
  })
  it('refuses an empty request, too many files, an empty file', () => {
    expect(checkFiles([])).toEqual({ error: 'no_files' })
    expect(checkFiles(Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`${i}.png`, 1))))
      .toEqual({ error: 'too_many_files', max: MAX_FILES })
    expect(checkFiles([file('a.png', 1), file('gol.png', 0)])).toEqual({ error: 'empty_file', filename: 'gol.png' })
  })
  it('refuses a file over the per-file cap, naming it', () => {
    expect(checkFiles([file('mare.jpg', MAX_FILE_BYTES + 1)]))
      .toEqual({ error: 'file_too_large', filename: 'mare.jpg', maxBytes: MAX_FILE_BYTES })
  })
  it('refuses a batch over the per-request cap even if each file fits', () => {
    const n = Math.floor(MAX_REQUEST_BYTES / MAX_FILE_BYTES) + 1
    expect(checkFiles(Array.from({ length: n }, (_, i) => file(`${i}.jpg`, MAX_FILE_BYTES))))
      .toEqual({ error: 'request_too_large', maxBytes: MAX_REQUEST_BYTES })
  })
})

describe('decodeBase64', () => {
  it('decodes plain base64 and data: URLs', () => {
    expect(Array.from(decodeBase64('AQID')!)).toEqual([1, 2, 3])
    expect(Array.from(decodeBase64('data:image/png;base64,AQID')!)).toEqual([1, 2, 3])
  })
  it('rejects garbage', () => {
    expect(decodeBase64('nu e base64!')).toBeNull()
  })
})

describe('filesFromJson', () => {
  it('reads a single file object', () => {
    const out = filesFromJson({ filename: 'a.png', data: 'AQID', contentType: 'image/png' })
    expect(Array.isArray(out) && out[0].filename).toBe('a.png')
    expect(Array.isArray(out) && Array.from(out[0].bytes)).toEqual([1, 2, 3])
  })
  it('reads a files array', () => {
    const out = filesFromJson({ files: [{ filename: 'a.png', data: 'AQID' }, { filename: 'b.txt', data: 'aGk=' }] })
    expect(Array.isArray(out) && out.map(f => f.filename)).toEqual(['a.png', 'b.txt'])
  })
  it('names the bad entry', () => {
    expect(filesFromJson({ files: [{ filename: 'a.png', data: 'AQID' }, { filename: 'b.png' }] }))
      .toEqual({ error: 'invalid_file', index: 1 })
    expect(filesFromJson({ filename: 'a.png', data: '%%%' })).toEqual({ error: 'invalid_file', index: 0 })
  })
})
