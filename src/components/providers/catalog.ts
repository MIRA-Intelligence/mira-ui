// Static provider catalog: brand icon (LobeHub static SVGs), a short
// bilingual description, and an optional docs URL. Keyed by the backend
// provider name (see mira_engine ProvidersConfig). Providers without an entry
// fall back to an initials badge and no description.
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg'
import groq from '@lobehub/icons-static-svg/icons/groq.svg'
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg'
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg'
import vllm from '@lobehub/icons-static-svg/icons/vllm-color.svg'
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg'
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg'
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg'
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg'
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg'
import xiaomi from '@lobehub/icons-static-svg/icons/xiaomimimo.svg'
import aihubmix from '@lobehub/icons-static-svg/icons/aihubmix-color.svg'
import siliconcloud from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg'
import volcengine from '@lobehub/icons-static-svg/icons/volcengine-color.svg'
import wenxin from '@lobehub/icons-static-svg/icons/wenxin-color.svg'
import azure from '@lobehub/icons-static-svg/icons/azure-color.svg'
import codex from '@lobehub/icons-static-svg/icons/codex-color.svg'
import githubcopilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg'
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg'
import bailian from '@lobehub/icons-static-svg/icons/bailian-color.svg'
import xai from '@lobehub/icons-static-svg/icons/xai.svg'

import type { Language } from '@/stores/settingsStore'

export interface ProviderCatalogEntry {
  icon?: string
  docsUrl?: string
  desc: Record<Language, string>
  // Warning shown prominently on the provider page, e.g. usage terms.
  notice?: Record<Language, string>
}

export const PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  anthropic: {
    icon: anthropic,
    docsUrl: 'https://docs.anthropic.com/en/api/overview',
    desc: { en: 'Claude models from Anthropic.', zh: 'Anthropic 的 Claude 系列模型。' },
  },
  openai: {
    icon: openai,
    docsUrl: 'https://platform.openai.com/docs/models',
    desc: { en: 'GPT and o-series models from OpenAI.', zh: 'OpenAI 的 GPT 与 o 系列模型。' },
  },
  openrouter: {
    icon: openrouter,
    docsUrl: 'https://openrouter.ai/docs',
    desc: { en: 'Unified gateway routing to many model providers.', zh: '统一网关，可路由到多家模型供应商。' },
  },
  deepseek: {
    icon: deepseek,
    docsUrl: 'https://api-docs.deepseek.com',
    desc: { en: 'DeepSeek chat and reasoner models.', zh: 'DeepSeek 对话与推理模型。' },
  },
  nvidia: {
    icon: nvidia,
    docsUrl: 'https://build.nvidia.com',
    desc: { en: 'NVIDIA NIM hosted models.', zh: 'NVIDIA NIM 托管模型。' },
  },
  groq: {
    icon: groq,
    docsUrl: 'https://console.groq.com/docs',
    desc: { en: 'Low-latency inference on Groq LPUs.', zh: 'Groq LPU 上的低延迟推理。' },
  },
  zhipu: {
    icon: zhipu,
    docsUrl: 'https://open.bigmodel.cn/dev/api',
    desc: { en: 'Zhipu GLM models.', zh: '智谱 GLM 系列模型。' },
  },
  zhipu_coding_plan: {
    icon: zhipu,
    docsUrl: 'https://docs.z.ai/devpack/quick-start',
    desc: {
      en: 'GLM Coding Plan subscription. Z.ai (international) subscribers: set the API base to https://api.z.ai/api/coding/paas/v4.',
      zh: '智谱 GLM Coding Plan 订阅套餐。Z.ai 国际版用户请将 API Base 设为 https://api.z.ai/api/coding/paas/v4。',
    },
    notice: {
      en: 'Terms of use: Zhipu (Z.ai) limits the GLM Coding Plan to the coding tools it officially supports, and Mira is not on that list. Using the plan in Mira may violate its terms and put your subscription at risk. To stay within the terms, use the pay-as-you-go Zhipu AI provider instead.',
      zh: '使用条款提示：智谱（Z.ai）规定 GLM Coding Plan 仅限在官方支持的编程工具中使用，Mira 目前不在该名单内。在 Mira 中使用此套餐可能违反条款，存在套餐权益受限的风险。如需合规使用，请改用按量计费的 Zhipu AI。',
    },
  },
  dashscope: {
    icon: qwen,
    docsUrl: 'https://help.aliyun.com/zh/model-studio',
    desc: { en: 'Alibaba Qwen models via DashScope.', zh: '阿里云百炼 DashScope 的通义千问模型。' },
  },
  dashscope_token_plan: {
    icon: bailian,
    docsUrl: 'https://help.aliyun.com/zh/model-studio/token-plan-quickstart',
    desc: {
      en: 'Alibaba Cloud Bailian Token Plan subscription (keys start with sk-sp-).',
      zh: '阿里云百炼 Token Plan 订阅套餐（专属 API Key 以 sk-sp- 开头）。',
    },
  },
  vllm: {
    icon: vllm,
    docsUrl: 'https://docs.vllm.ai',
    desc: { en: 'Self-hosted vLLM OpenAI-compatible server.', zh: '自托管的 vLLM OpenAI 兼容服务。' },
  },
  ollama: {
    icon: ollama,
    docsUrl: 'https://ollama.com',
    desc: { en: 'Local models served by Ollama.', zh: '由 Ollama 在本地提供的模型。' },
  },
  ovms: {
    desc: { en: 'OpenVINO Model Server (local).', zh: 'OpenVINO 模型服务（本地）。' },
  },
  gemini: {
    icon: gemini,
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    desc: { en: 'Google Gemini models.', zh: '谷歌 Gemini 系列模型。' },
  },
  moonshot: {
    icon: moonshot,
    docsUrl: 'https://platform.moonshot.cn',
    desc: { en: 'Moonshot Kimi models.', zh: '月之暗面 Kimi 系列模型。' },
  },
  kimi_code: {
    icon: kimi,
    docsUrl: 'https://www.kimi.com/code/docs/en/',
    desc: {
      en: 'Kimi Code, included in the Kimi membership. Overseas members: set the API base to https://api.kimi.ai/coding/v1.',
      zh: 'Kimi 会员附带的 Kimi Code。海外会员请将 API Base 设为 https://api.kimi.ai/coding/v1。',
    },
  },
  minimax: {
    icon: minimax,
    docsUrl: 'https://platform.minimaxi.com',
    desc: { en: 'MiniMax models.', zh: 'MiniMax 系列模型。' },
  },
  minimax_token_plan: {
    icon: minimax,
    docsUrl: 'https://platform.minimaxi.com/docs/token-plan/quickstart',
    desc: {
      en: 'MiniMax Token Plan subscription. International subscribers: set the API base to https://api.minimax.io/v1.',
      zh: 'MiniMax Token Plan 订阅套餐。国际版用户请将 API Base 设为 https://api.minimax.io/v1。',
    },
  },
  mistral: {
    icon: mistral,
    docsUrl: 'https://docs.mistral.ai',
    desc: { en: 'Mistral AI models.', zh: 'Mistral AI 系列模型。' },
  },
  xai: {
    icon: xai,
    docsUrl: 'https://docs.x.ai',
    desc: { en: 'xAI Grok models.', zh: 'xAI 的 Grok 系列模型。' },
  },
  stepfun: {
    icon: stepfun,
    docsUrl: 'https://platform.stepfun.com',
    desc: { en: 'StepFun (阶跃星辰) models.', zh: '阶跃星辰 StepFun 系列模型。' },
  },
  xiaomi_mimo: {
    icon: xiaomi,
    desc: { en: 'Xiaomi MiMo models.', zh: '小米 MiMo 系列模型。' },
  },
  aihubmix: {
    icon: aihubmix,
    docsUrl: 'https://docs.aihubmix.com',
    desc: { en: 'AiHubMix API gateway.', zh: 'AiHubMix API 网关。' },
  },
  siliconflow: {
    icon: siliconcloud,
    docsUrl: 'https://docs.siliconflow.cn',
    desc: { en: 'SiliconFlow (硅基流动) hosted models.', zh: '硅基流动 SiliconFlow 托管模型。' },
  },
  volcengine: {
    icon: volcengine,
    docsUrl: 'https://www.volcengine.com/docs/82379',
    desc: { en: 'VolcEngine (火山引擎) Ark models.', zh: '火山引擎方舟模型。' },
  },
  volcengine_coding_plan: {
    icon: volcengine,
    desc: { en: 'VolcEngine coding plan endpoint.', zh: '火山引擎编程套餐端点。' },
  },
  volcengine_agent_plan: {
    icon: volcengine,
    desc: { en: 'VolcEngine Ark Agent Plan subscription.', zh: '火山方舟 Agent Plan 订阅套餐。' },
  },
  byteplus: {
    icon: volcengine,
    docsUrl: 'https://docs.byteplus.com',
    desc: { en: 'BytePlus (VolcEngine international).', zh: 'BytePlus（火山引擎国际版）。' },
  },
  byteplus_coding_plan: {
    icon: volcengine,
    desc: { en: 'BytePlus coding plan endpoint.', zh: 'BytePlus 编程套餐端点。' },
  },
  qianfan: {
    icon: wenxin,
    docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP',
    desc: { en: 'Baidu Qianfan (ERNIE) models.', zh: '百度千帆 ERNIE 系列模型。' },
  },
  azure_openai: {
    icon: azure,
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai',
    desc: { en: 'Azure OpenAI deployments.', zh: 'Azure OpenAI 部署。' },
  },
  openai_codex: {
    icon: codex,
    desc: { en: 'OpenAI Codex (OAuth).', zh: 'OpenAI Codex（OAuth 授权）。' },
  },
  github_copilot: {
    icon: githubcopilot,
    desc: { en: 'GitHub Copilot (OAuth).', zh: 'GitHub Copilot（OAuth 授权）。' },
  },
  custom: {
    desc: { en: 'Any OpenAI-compatible endpoint.', zh: '任意 OpenAI 兼容端点。' },
  },
}

export function providerDescription(provider: string, lang: Language): string | null {
  return PROVIDER_CATALOG[provider]?.desc[lang] ?? null
}

export function providerNotice(provider: string, lang: Language): string | null {
  return PROVIDER_CATALOG[provider]?.notice?.[lang] ?? null
}

export function providerDocsUrl(provider: string): string | null {
  return PROVIDER_CATALOG[provider]?.docsUrl ?? null
}
