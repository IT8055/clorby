import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Environment checks for Clorby. Phase 1 confirms Node, locates the Claude Code
// CLI and warns if an API key is present. The SDK ping arrives in phase 2.

let hardFailure = false

function ok(message) {
  console.log(`  ok    ${message}`)
}

function warn(message) {
  console.log(`  warn  ${message}`)
}

function fail(message) {
  console.log(`  fail  ${message}`)
  hardFailure = true
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  if (major >= 20) ok(`Node ${process.versions.node}`)
  else fail(`Node ${process.versions.node} is too old. Clorby needs Node 20 or newer.`)
}

function checkApiKey() {
  const offenders = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter((name) => process.env[name])
  if (offenders.length === 0) {
    ok('No API key in the environment. Usage will bill the Claude subscription.')
  } else {
    warn(`${offenders.join(' and ')} is set. The SDK would bill the API, not the plan.`)
    warn('Remove it from the machine, or rely on Clorby scrubbing it from the child process.')
  }
}

function savedClaudePath() {
  try {
    const file = join(homedir(), 'AppData', 'Roaming', 'clorby', 'settings.json')
    if (!existsSync(file)) return null
    const settings = JSON.parse(readFileSync(file, 'utf8'))
    return settings.claudeExecutablePath ?? null
  } catch {
    return null
  }
}

// Resolve the candidate for the SDK ping. A miss on PATH is only a warning:
// the SDK has its own resolution and often finds Claude Code anyway, so the
// ping below is the authoritative check.
function checkClaude() {
  const override = savedClaudePath()
  const candidate = override ?? 'claude'
  const versionFlag = ['-', '-version'].join('')
  // Single command string (not args + shell) to avoid the DEP0190 warning.
  const result = spawnSync(`${candidate} ${versionFlag}`, { encoding: 'utf8', shell: true })
  if (result.error || result.status !== 0) {
    warn(`"${candidate}" is not on PATH. The SDK may still locate it; see the ping below.`)
    return candidate
  }
  const version = (result.stdout || '').trim() || 'version reported'
  ok(`Claude Code found (${candidate}): ${version}`)
  return candidate
}

function scrubbedEnv() {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

// Phase 2 ping: start a session, read the init message to confirm which auth
// the SDK is using, then abort before the model is called so it costs nothing.
async function checkSdkPing(candidate) {
  let queryFn
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    queryFn = sdk.query
  } catch (err) {
    fail(`Could not load the Agent SDK: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 20000)
  try {
    const stream = queryFn({
      prompt: 'ping',
      options: {
        allowedTools: [],
        abortController: abort,
        env: scrubbedEnv(),
        pathToClaudeCodeExecutable: candidate === 'claude' ? undefined : candidate
      }
    })
    for await (const msg of stream) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        // 'none' (no key) and 'oauth' (login) both mean the subscription path.
        if (msg.apiKeySource === 'none' || msg.apiKeySource === 'oauth') {
          ok(`SDK ping ok. Auth: ${msg.apiKeySource} (subscription), model: ${msg.model}.`)
        } else {
          warn(`SDK ping ok but auth is "${msg.apiKeySource}", which bills an API key.`)
        }
        abort.abort()
        break
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      fail(`SDK ping failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

console.log('Clorby doctor')
checkNode()
checkApiKey()
const claudePath = checkClaude()
if (claudePath) await checkSdkPing(claudePath)

process.exit(hardFailure ? 1 : 0)
