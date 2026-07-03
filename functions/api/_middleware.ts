export function isValidKey(provided: string | null, expected: string): boolean {
  return provided !== null && provided === expected
}

interface Env {
  TICKETS_API_KEY: string
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const provided = context.request.headers.get('X-API-Key')
  if (!isValidKey(provided, context.env.TICKETS_API_KEY)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return context.next()
}
