addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

/**
 * Simple Cloudflare Worker that exposes a tiny "drive" API backed by an R2 bucket.
 * Endpoints:
 * - PUT  /files/:key    -> upload file body to key
 * - GET  /files          -> list files (json)
 * - GET  /files/:key    -> download file
 * - DELETE /files/:key  -> delete file
 *
 * Binding: AI_SHORTS_BUCKET (configured in wrangler.toml)
 */

async function handleRequest(request) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)

  // health
  if (parts.length === 0) {
    return new Response(JSON.stringify({ message: 'ai-shorts drive worker' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // /files
  if (parts[0] === 'files') {
    // list
    if (parts.length === 1 && request.method === 'GET') {
      try {
        const { objects } = await AI_SHORTS_BUCKET.list({ limit: 100 })
        const files = objects.map(o => ({ key: o.key, size: o.size, etag: o.etag }))
        return new Response(JSON.stringify({ files }), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // file operations with key
    if (parts.length >= 2) {
      const key = parts.slice(1).join('/')

      if (request.method === 'PUT' || request.method === 'POST') {
        // Put the raw body as the object
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream'
        try {
          const body = await request.arrayBuffer()
          await AI_SHORTS_BUCKET.put(key, body, { httpMetadata: { contentType } })
          return new Response(JSON.stringify({ ok: true, key }), { headers: { 'Content-Type': 'application/json' } })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
      }

      if (request.method === 'GET') {
        try {
          const object = await AI_SHORTS_BUCKET.get(key)
          if (!object) return new Response('Not found', { status: 404 })
          const headers = new Headers()
          if (object.httpMetadata && object.httpMetadata.contentType) headers.set('Content-Type', object.httpMetadata.contentType)
          if (object.size != null) headers.set('Content-Length', String(object.size))
          return new Response(object.body, { headers })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
      }

      if (request.method === 'DELETE') {
        try {
          await AI_SHORTS_BUCKET.delete(key)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
      }

      return new Response('Method Not Allowed', { status: 405 })
    }
  }

  return new Response('Not Found', { status: 404 })
}
