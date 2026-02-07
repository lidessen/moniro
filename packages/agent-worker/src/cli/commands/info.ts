import type { Command } from 'commander'
import { FRONTIER_MODELS, getDefaultModel } from '../../agent/models.ts'

// Provider API key configuration
const PROVIDER_API_KEYS: Record<string, { envVar: string; description: string }> = {
  gateway: { envVar: 'AI_GATEWAY_API_KEY', description: 'Vercel AI Gateway (all providers)' },
  anthropic: { envVar: 'ANTHROPIC_API_KEY', description: 'Anthropic Claude' },
  openai: { envVar: 'OPENAI_API_KEY', description: 'OpenAI GPT' },
  deepseek: { envVar: 'DEEPSEEK_API_KEY', description: 'DeepSeek' },
  google: { envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', description: 'Google Gemini' },
  groq: { envVar: 'GROQ_API_KEY', description: 'Groq' },
  mistral: { envVar: 'MISTRAL_API_KEY', description: 'Mistral' },
  xai: { envVar: 'XAI_API_KEY', description: 'xAI Grok' },
  minimax: { envVar: 'MINIMAX_API_KEY', description: 'MiniMax' },
}

export function registerInfoCommands(program: Command) {
  // Providers command
  program
    .command('providers')
    .description('Check provider availability')
    .action(() => {
      console.log('Provider Status:\n')

      for (const [name, config] of Object.entries(PROVIDER_API_KEYS)) {
        const isConfigured = !!process.env[config.envVar]
        const status = isConfigured ? '✓' : '✗'
        const statusText = isConfigured ? '' : ' (not configured)'
        const envHint = isConfigured ? '' : ` [${config.envVar}]`
        // Show default model for each provider
        const defaultModel = name === 'gateway'
          ? ''
          : ` → ${name}/${FRONTIER_MODELS[name as keyof typeof FRONTIER_MODELS]?.[0] || '?'}`
        console.log(`  ${status} ${name.padEnd(10)} - ${config.description}${statusText}${envHint}${defaultModel}`)
      }

      // Get example models from FRONTIER_MODELS
      const defaultModel = getDefaultModel()
      const gatewayExample = `openai/${FRONTIER_MODELS.openai[0]}`
      const directExample = `deepseek:${FRONTIER_MODELS.deepseek[0]}`

      console.log('\nUsage:')
      console.log(`  Provider only:   provider         (e.g., openai → ${gatewayExample})`)
      console.log(`  Gateway format:  provider/model   (e.g., ${gatewayExample})`)
      console.log(`  Direct format:   provider:model   (e.g., ${directExample})`)
      console.log(`\nDefault: ${defaultModel} (when no model specified)`)
    })

  // Backends command
  program
    .command('backends')
    .description('Check available backends (SDK, CLI tools)')
    .action(async () => {
      const { listBackends } = await import('../../backends/index.ts')
      const backends = await listBackends()

      console.log('Backend Status:\n')

      for (const backend of backends) {
        const status = backend.available ? '✓' : '✗'
        const statusText = backend.available ? '' : ' (not installed)'
        console.log(`  ${status} ${backend.type.padEnd(8)} - ${backend.name}${statusText}`)
      }

      console.log('\nUsage:')
      console.log('  SDK backend:    agent-worker new myagent -m openai/gpt-5.2')
      console.log('  SDK backend:    agent-worker new myagent -m anthropic/claude-sonnet-4-5')
      console.log('  Claude CLI:     agent-worker new myagent -b claude')
      console.log('  Codex CLI:      agent-worker new myagent -b codex')
      console.log('  Cursor CLI:     agent-worker new myagent -b cursor')
      console.log('')
      console.log('Note: CLI backends use their own model selection. The -m flag is optional.')
      console.log('Tool management (add, mock, import) is only supported with SDK backend.')
    })
}
