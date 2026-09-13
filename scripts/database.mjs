import 'dotenv/config'
import dotenv from 'dotenv'
import pg from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

dotenv.config({ path: '.env.server.local', quiet: true })
dotenv.config({ path: '.env.local', quiet: true })
const mode = process.argv[2] || 'check'
const connectionString = mode === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!connectionString)
  throw new Error(
    mode === 'test'
      ? 'Set TEST_DATABASE_URL to an isolated local test database.'
      : 'DATABASE_URL is missing from .env.server.local',
  )
if (mode === 'test') {
  const u = new URL(connectionString)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
    !u.pathname.includes('agape_test')
  ) {
    throw new Error('Tests may only run in a local database named agape_test.')
  }
}
function connectionOptions(value) {
  if (/^postgres(?:ql)?:\/\//.test(value)) return { connectionString: value }
  // Allways uses libpq's host=... dbname=... format, not a PostgreSQL URI.
  const fields = {}
  const pattern = /\s*(\w+)\s*=\s*(?:'((?:\\.|[^'])*)'|(\S+))/gy
  let offset = 0
  while (offset < value.trimEnd().length) {
    pattern.lastIndex = offset
    const match = pattern.exec(value)
    if (!match) throw new Error('Invalid libpq connection configuration')
    fields[match[1]] = (match[2] ?? match[3]).replace(/\\(.)/g, '$1')
    offset = pattern.lastIndex
  }
  const { dbname, sslmode, ...rest } = fields
  // Respect libpq require (encryption) vs verify-full (CA + hostname verification).
  return {
    ...rest,
    database: dbname,
    port: Number(fields.port || 5432),
    ssl:
      sslmode && sslmode !== 'disable'
        ? { rejectUnauthorized: sslmode === 'verify-full' || sslmode === 'verify-ca' }
        : undefined,
  }
}
const client = new pg.Client({
  ...connectionOptions(connectionString),
  connectionTimeoutMillis: 12000,
  application_name: 'agape-migrations',
})
const hash = (text) => createHash('sha256').update(text).digest('hex')
async function migrate() {
  await client.query('begin')
  try {
    await client.query('select pg_advisory_xact_lock(71423092)')
    const {
      rows: [state],
    } = await client.query(
      "select to_regnamespace('agape') is not null as exists, to_regclass('agape._migrations') is not null as managed",
    )
    if (state.exists && !state.managed)
      throw new Error('An unmanaged agape schema already exists. Refusing to modify it.')
    const applied = state.managed
      ? (await client.query('select * from agape._migrations')).rows
      : []
    for (const name of (await readdir('supabase/migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const sql = await readFile(`supabase/migrations/${name}`, 'utf8')
      const previous = applied.find((row) => row.name === name)
      if (previous) {
        if (previous.sha256 !== hash(sql)) throw new Error(`Applied migration changed: ${name}`)
        continue
      }
      await client.query(sql)
      if (!state.managed) {
        await client.query(
          'create table agape._migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now()); alter table agape._migrations enable row level security; revoke all on agape._migrations from anon,authenticated,service_role',
        )
        state.managed = true
      }
      await client.query('insert into agape._migrations(name,sha256) values($1,$2)', [
        name,
        hash(sql),
      ])
      console.log(`Applied ${name}`)
    }
    await client.query("notify pgrst, 'reload schema'")
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  }
}
try {
  await client.connect()
  if (mode === 'test') {
    await client.query(await readFile('tests/bootstrap.sql', 'utf8'))
    await migrate()
    await client.query(await readFile('tests/isolation.sql', 'utf8'))
    await client.query('begin')
    try {
      await client.query(await readFile('tests/subtitle-history.sql', 'utf8'))
    } finally {
      await client.query('rollback')
    }
    console.log('Passed: subtitle history, stale edits, restoration, and access control.')
    await client.query('begin')
    try {
      await client.query(await readFile('tests/tv-programs.sql', 'utf8'))
    } finally {
      await client.query('rollback')
    }
    console.log('Passed: named TVs per topic, layouts, subtitles, editions, and permissions.')
    await client.query('begin')
    try {
      await client.query(await readFile('tests/review.sql', 'utf8'))
    } finally {
      await client.query('rollback')
    }
    console.log('Passed: review reasons, single decisions, and submission status visibility.')
    console.log(
      'Passed: ontology isolation, RLS, subtree eligibility, ownership, moderation, timing, cycles, and localized navigation.',
    )
  } else if (mode === 'migrate') {
    await migrate()
  } else if (mode === 'seed-topics') {
    const { nodes } = JSON.parse(await readFile('data/initial-ontology.json', 'utf8'))
    await client.query('begin')
    try {
      await client.query('select pg_advisory_xact_lock(71423092)')
      const ids = new Map()
      let created = 0
      for (const topic of nodes) {
        if (topic.parent && !ids.has(topic.parent))
          throw new Error('Seed parent must precede its child')
        const parent = topic.parent ? ids.get(topic.parent) : null
        const inserted = await client.query(
          'insert into agape.ontology_node(parent_id,slug,position) values($1,$2,$3) on conflict(parent_id,slug) do nothing returning node_id',
          [parent, topic.slug, nodes.filter((n) => n.parent === topic.parent).indexOf(topic)],
        )
        let id = inserted.rows[0]?.node_id
        if (id) {
          created++
          await client.query(
            "insert into agape.node_name(node_id,locale,name,description) values($1,'en',$2,$3)",
            [id, topic.name, topic.description],
          )
          await client.query(
            "insert into agape.translation_job(node_id,locale) select $1,locale from agape.locale where locale<>'en'",
            [id],
          )
        } else {
          id = (
            await client.query(
              'select node_id from agape.ontology_node where parent_id is not distinct from $1::uuid and slug=$2',
              [parent, topic.slug],
            )
          ).rows[0].node_id
        }
        ids.set(topic.slug, id)
      }
      await client.query('commit')
      console.log(
        `Agape topics: ${created} created; ${nodes.length - created} already present. Existing topics preserved.`,
      )
      console.log('AI Music:', ids.get('ai-music'))
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  } else if (mode === 'seed-tv') {
    await client.query('begin')
    try {
      await client.query('select pg_advisory_xact_lock(71423092)')
      await client.query(await readFile('data/eminescu-tv.sql', 'utf8'))
      const { rows } = await client.query(
        "select n.node_id,count(*)::integer as fragments,sum(f.end_seconds-f.start_seconds)::integer as loop_seconds from agape.curated_tv_fragment f join agape.ontology_node n using(node_id) where n.slug='mihai-eminescu' group by n.node_id",
      )
      await client.query('commit')
      console.log(rows)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  } else if (mode === 'check-tv-access') {
    const {
      rows: [access],
    } = await client.query(
      "select has_table_privilege('anon','agape.curated_tv_fragment','SELECT') as readable, has_table_privilege('authenticated','agape.curated_tv_fragment','INSERT,UPDATE,DELETE') as writable, (select relrowsecurity from pg_class where oid='agape.curated_tv_fragment'::regclass) as rls",
    )
    if (!access.readable || access.writable || !access.rls)
      throw new Error('Unexpected curated TV access privileges')
    console.log('Curated TV: RLS enabled, public reads allowed, browser writes denied.')
  } else if (mode === 'test-tv-subtitles' || mode === 'test-subtitle-history') {
    await client.query('begin')
    try {
      await client.query(
        await readFile(
          mode === 'test-subtitle-history'
            ? 'tests/subtitle-history.sql'
            : 'tests/tv-subtitles.sql',
          'utf8',
        ),
      )
      console.log('Passed: subtitle checks (' + mode + '). Test data rolled back.')
    } finally {
      await client.query('rollback')
    }
  } else if (mode === 'seed-subtitles') {
    await client.query('begin')
    try {
      await client.query(await readFile('data/eminescu-subtitles.sql', 'utf8'))
      const { rows } = await client.query(
        "select count(*)::integer as cues,count(distinct fragment_id)::integer as excerpts from agape.tv_subtitle_cue where track='version1'",
      )
      await client.query('commit')
      console.log(rows)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  } else if (mode === 'admin') {
    const email = process.argv[3]
    if (!email) throw new Error('Usage: npm run db:admin -- your-google-email (sign in first)')
    const { rowCount } = await client.query(
      "insert into agape.members(user_id,role) select id,'admin' from auth.users where lower(email)=lower($1) on conflict(user_id) do update set role='admin'",
      [email],
    )
    if (!rowCount) throw new Error('No signed-in user found with that email.')
    console.log('Agape administrator assigned.')
  } else if (mode === 'expose') {
    // Preserve the existing schema list: never replace Allways' API configuration.
    const { rows } = await client.query(
      "select rolconfig from pg_roles where rolname='authenticator'",
    )
    const setting = (rows[0]?.rolconfig || []).find((v) => v.startsWith('pgrst.db_schemas='))
    let names
    if (setting)
      names = setting
        .slice('pgrst.db_schemas='.length)
        .split(',')
        .map((s) => s.trim())
    else {
      // The project may configure its schema list in PostgREST's environment.
      // Its PGRST106 response reports that effective list; preserve it verbatim.
      const response = await fetch(
        `${process.env.VITE_SUPABASE_URL}/rest/v1/ontology_node?select=node_id&limit=0`,
        {
          headers: {
            apikey: process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Accept-Profile': 'agape',
          },
          signal: AbortSignal.timeout(12000),
        },
      )
      const body = await response.json()
      if (response.ok) {
        console.log('Agape is already exposed through the Data API.')
        await client.end()
        process.exit(0)
      }
      const prefix = 'The schema must be one of the following: ',
        hintPrefix = 'Only the following schemas are exposed: '
      const list = body.message?.startsWith(prefix)
        ? body.message.slice(prefix.length)
        : body.hint?.startsWith(hintPrefix)
          ? body.hint.slice(hintPrefix.length)
          : null
      if (body.code !== 'PGRST106' || !list)
        throw new Error(
          'Unable to determine the existing exposed schemas. Add agape through Supabase API settings.',
        )
      names = list.split(',').map((s) => s.trim())
      if (!names.every((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)))
        throw new Error('Unexpected exposed-schema list; use Supabase API settings.')
    }
    if (!names.includes('agape')) {
      const value = [...names, 'agape'].join(', ')
      const {
        rows: [quoted],
      } = await client.query('select quote_literal($1) as value', [value])
      await client.query(`alter role authenticator set pgrst.db_schemas = ${quoted.value}`)
      await client.query("notify pgrst, 'reload config'; notify pgrst, 'reload schema'")
    }
    console.log('Agape added to exposed schemas; existing schemas preserved.')
  } else if (mode === 'check') {
    const {
      rows: [info],
    } = await client.query(
      "select to_regnamespace('agape') is not null as agape_exists,to_regclass('public.ontology_node') is not null as allways_exists",
    )
    console.log('Connection OK.', info)
    if (info.agape_exists) {
      const { rows } = await client.query(
        "select count(*)::integer as cross_ontology_foreign_keys from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_class r on r.oid=c.confrelid join pg_namespace rn on rn.oid=r.relnamespace where c.contype='f' and n.nspname='agape' and rn.nspname not in ('agape','auth')",
      )
      console.log(rows[0])
    }
  } else throw new Error('Unknown database command')
} catch (e) {
  // Never print a connection string, query parameters, or credential-bearing stack.
  const message = String(e.message).replaceAll(connectionString, '[database]')
  console.error(`${e.code ? e.code + ': ' : ''}${message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
