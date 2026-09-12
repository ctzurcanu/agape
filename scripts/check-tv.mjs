import dotenv from 'dotenv'
import assert from 'node:assert/strict'
dotenv.config({ path: '.env.local', quiet: true })
async function tv(node) {
  const response = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/tv_browse`, {
    method: 'POST',
    headers: {
      apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Profile': 'agape',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_node: node, p_locale: 'en' }),
  })
  assert.equal(response.status, 200)
  return response.json()
}
const all = await tv(null)
const selected = all.fragments.filter((f) => f.playlist_id === 'PLrZFPVQM38MfjRjEyCgSk5T8SZ-nwzJ0U')
assert.equal(selected.length, 7)
assert.equal(
  selected.reduce((n, f) => n + f.end_seconds - f.start_seconds, 0),
  315,
)
assert.equal(selected[0].video_id, '7o8iZjM5qzA')
const scoped = await tv(selected[0].node_id)
assert.equal(scoped.fragments.length, 7)
for (const parent of scoped.breadcrumbs) {
  const branch = await tv(parent.node_id)
  assert.equal(branch.fragments.filter((f) => f.playlist_id === selected[0].playlist_id).length, 7)
}
const missing = await tv('00000000-0000-4000-8000-000000000000')
assert.equal(missing.fragments.length, 0)
console.log(
  'TV API verified: seven bounded excerpts, playlist order, 315-second loop, ancestor navigation, and no results for unknown topics.',
)
