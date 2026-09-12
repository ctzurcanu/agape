import { readFile, chmod } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import dotenv from 'dotenv'

// Credentials stay in memory and are never included in command arguments or logs.
const google = dotenv.parse(await readFile('.env.google.local'))
const browser = dotenv.parse(await readFile('.env.local'))
if (
  !google.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') ||
  !google.GOOGLE_CLIENT_SECRET
) {
  throw new Error('The local Google OAuth credential file is incomplete.')
}
await chmod('.env.google.local', 0o600)
const project = new URL(browser.VITE_SUPABASE_URL).hostname.split('.')[0]
let token = process.env.SUPABASE_ACCESS_TOKEN
if (!token && process.platform === 'darwin') {
  for (const account of ['supabase', 'access-token']) {
    try {
      token = execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'Supabase CLI', '-a', account, '-w'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim()
      // Match go-keyring's macOS serialization used by the Supabase CLI.
      if (token.startsWith('go-keyring-base64:'))
        token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8')
      else if (token.startsWith('go-keyring-encoded:'))
        token = Buffer.from(token.slice('go-keyring-encoded:'.length), 'hex').toString('utf8')
      if (token) break
    } catch {
      /* Try the documented legacy key and token-file fallback. */
    }
  }
}
if (!token) {
  try {
    token = (await readFile(`${homedir()}/.supabase/access-token`, 'utf8')).trim()
  } catch {
    /* Report only the missing sign-in. */
  }
}
if (!token) throw new Error('Supabase CLI sign-in is unavailable. Run supabase login first.')


const endpoint=`https://api.supabase.com/v1/projects/${project}`;
const headers={Authorization:`Bearer ${token}`};
const cfgResponse=await fetch(endpoint+'/config/auth',{headers});
if(!cfgResponse.ok)throw new Error('Configuration read failed: '+cfgResponse.status);
const cfg=await cfgResponse.json();
console.log({clientMatches:cfg.external_google_client_id===google.GOOGLE_CLIENT_ID,googleEnabled:cfg.external_google_enabled});
const u=new URL(endpoint+'/analytics/endpoints/logs');
u.searchParams.set('iso_timestamp_start',new Date(Date.now()-90*60000).toISOString());
u.searchParams.set('iso_timestamp_end',new Date().toISOString());
u.searchParams.set('sql',"select timestamp, log_attributes['error'] as error from logs where source = 'auth_logs' and (event_message ilike '%exchange%' or event_message ilike '%callback%') order by timestamp desc limit 15");
const response=await fetch(u,{headers});
const data=await response.json();
// Redact OAuth codes, tokens, and supplied secrets before displaying errors.
function redact(value){return String(value).replaceAll(google.GOOGLE_CLIENT_SECRET,'[secret]').replaceAll(google.GOOGLE_CLIENT_ID,'[client]').replace(/4(?:%2F|\/)[A-Za-z0-9_\-%.]+/g,'[authorization-code]').replace(/eyJ[A-Za-z0-9_.-]+/g,'[token]');}
console.log('Log response:',response.status);
console.log(redact(JSON.stringify(data.result?.filter(r=>r.error?.includes('invalid_client')).map(r=>({timestamp:r.timestamp,error:r.error})) || data.error || {})));

// A deliberately invalid code checks client authentication without signing anyone in.
const probe = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: google.GOOGLE_CLIENT_ID,
    client_secret: google.GOOGLE_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: 'agape-diagnostic-invalid-code',
    redirect_uri: `${browser.VITE_SUPABASE_URL}/auth/v1/callback`,
  }),
  signal: AbortSignal.timeout(15000),
});
const probeResult = await probe.json();
console.log('Google credential probe:', redact(JSON.stringify({status:probe.status,error:probeResult.error,description:probeResult.error_description})));

const control = await fetch('https://oauth2.googleapis.com/token', {method:'POST',body:new URLSearchParams({client_id:google.GOOGLE_CLIENT_ID,client_secret:'agape-diagnostic-invalid-secret',grant_type:'authorization_code',code:'agape-diagnostic-invalid-code',redirect_uri:`${browser.VITE_SUPABASE_URL}/auth/v1/callback`})});
const controlResult=await control.json();
console.log('Invalid secret control:',JSON.stringify({status:control.status,error:controlResult.error,description:controlResult.error_description}));
