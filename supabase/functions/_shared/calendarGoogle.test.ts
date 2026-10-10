import { describe, expect, it } from 'vitest'
import { calendarName, defaultEnabled, emailFromIdToken, grantedCalendar, mapEvent, meetUrl, syncWindow } from './calendarGoogle'

describe('defaultEnabled', () => {
  it('calendarele omului pornesc, cele generate nu', () => {
    expect(defaultEnabled({ id: 'ion@firma.ro', primary: true })).toBe(true)
    expect(defaultEnabled({ id: 'abc123@group.calendar.google.com' })).toBe(true)
    expect(defaultEnabled({ id: 'ro.romanian#holiday@group.v.calendar.google.com' })).toBe(false)
    expect(defaultEnabled({ id: 'addressbook#contacts@group.v.calendar.google.com' })).toBe(false)
    expect(defaultEnabled({ id: 'e#weeknum@group.v.calendar.google.com' })).toBe(false)
  })
  it('ascuns sau debifat în Google: oprit', () => {
    expect(defaultEnabled({ id: 'x@group.calendar.google.com', selected: false })).toBe(false)
    expect(defaultEnabled({ id: 'x@group.calendar.google.com', hidden: true })).toBe(false)
  })
  it('numele: override, apoi summary, apoi id', () => {
    expect(calendarName({ id: 'a', summary: 'S', summaryOverride: 'O' })).toBe('O')
    expect(calendarName({ id: 'a', summary: 'S' })).toBe('S')
    expect(calendarName({ id: 'a' })).toBe('a')
  })
})

describe('mapEvent', () => {
  it('cu oră, cu răspunsul meu și Meet', () => {
    expect(mapEvent({
      id: 'ev1', summary: ' Standup ', htmlLink: 'https://g/1', hangoutLink: 'https://meet.google.com/abc',
      start: { dateTime: '2026-10-12T10:00:00+03:00' }, end: { dateTime: '2026-10-12T10:15:00+03:00' },
      attendees: [{ responseStatus: 'accepted' }, { self: true, responseStatus: 'declined' }],
    })).toEqual({
      google_id: 'ev1', title: 'Standup', all_day: false,
      start_at: '2026-10-12T07:00:00.000Z', end_at: '2026-10-12T07:15:00.000Z', start_date: null, end_date: null,
      location: null, meet_url: 'https://meet.google.com/abc', html_link: 'https://g/1', response: 'declined',
    })
  })
  it('toată ziua, multi-zi (sfârșit exclusiv, ca la Google)', () => {
    const r = mapEvent({ id: 'ev2', summary: 'Concediu', start: { date: '2026-10-12' }, end: { date: '2026-10-15' } })
    expect(r).toMatchObject({ all_day: true, start_date: '2026-10-12', end_date: '2026-10-15', start_at: null, response: null })
  })
  it('anulate, „locul de muncă" și capete stricate: afară', () => {
    expect(mapEvent({ id: 'a', status: 'cancelled', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } })).toBeNull()
    expect(mapEvent({ id: 'b', eventType: 'workingLocation', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } })).toBeNull()
    expect(mapEvent({ id: 'c', start: { dateTime: 'nu' }, end: { dateTime: '2026-10-12T10:00:00Z' } })).toBeNull()
  })
  it('titlu lipsă rămâne gol (interfața spune „fără titlu")', () => {
    expect(mapEvent({ id: 'd', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } })?.title).toBe('')
  })
})

describe('meetUrl', () => {
  it('conferenceData, apoi link scris de mână în loc sau descriere', () => {
    expect(meetUrl({ id: 'x', conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://zoom.us/j/1' }] } })).toBe('https://zoom.us/j/1')
    expect(meetUrl({ id: 'x', location: 'Sala 2' , description: 'Intră: https://firma.zoom.us/j/987?pwd=x. Mersi' })).toBe('https://firma.zoom.us/j/987?pwd=x')
    expect(meetUrl({ id: 'x', location: 'https://teams.microsoft.com/l/meetup-join/abc' })).toBe('https://teams.microsoft.com/l/meetup-join/abc')
    expect(meetUrl({ id: 'x', location: 'Cafenea' })).toBeNull()
  })
})

describe('restul', () => {
  it('fereastra', () => {
    const now = Date.parse('2026-10-10T12:00:00Z')
    expect(syncWindow(now)).toEqual({ timeMin: '2026-10-09T12:00:00.000Z', timeMax: '2026-10-18T12:00:00.000Z' })
  })
  it('scope-ul de calendar acordat sau debifat', () => {
    expect(grantedCalendar('openid https://www.googleapis.com/auth/calendar.readonly email')).toBe(true)
    expect(grantedCalendar('openid email')).toBe(false)
    expect(grantedCalendar(undefined)).toBe(false)
  })
  it('emailul din id_token', () => {
    const payload = btoa(JSON.stringify({ email: 'Ion@Firma.ro' })).replace(/=+$/, '')
    expect(emailFromIdToken(`h.${payload}.s`)).toBe('ion@firma.ro')
    expect(emailFromIdToken('stricat')).toBeNull()
    expect(emailFromIdToken(undefined)).toBeNull()
  })
})
