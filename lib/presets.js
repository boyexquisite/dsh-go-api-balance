// 内置模板：DeepSeek 官方 / new-api 中转 / Kimi / 小米 MiMo / 自定义。
export const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek 官方' },
  { id: 'newapi', label: 'new-api / one-api 中转' },
  { id: 'kimi', label: 'Kimi / Moonshot' },
  { id: 'mimo', label: '小米 MiMo' },
]

function baseDraft (token) {
  return {
    preset: 'custom',
    name: '',
    url: '',
    method: 'GET',
    authType: 'bearer',
    secret: typeof token === 'string' ? token : '',
    username: '',
    loginUrl: '',
    tokenPath: 'data.token',
    tokenHeader: 'Authorization',
    tokenPrefix: 'Bearer ',
    secretHeader: 'X-API-Key',
    secretParam: 'key',
    headersText: '',
    bodyText: '',
    balancePath: '',
    currencyPath: '',
    detailPaths: [],
    usageUrl: '',
    usageMethod: 'GET',
    usageArrayPath: '',
    usageFields: [],
    usageScale: false,
    divisor: 1,
    multiplier: 1,
    symbol: '¥',
    decimals: 2,
    enabled: true,
    autoUnit: false,
    region: 'cn',
  }
}

function normalizeRate (rate) {
  const number = Number(rate)
  return Number.isFinite(number) && number > 0 ? number : 1
}

function newApiBase (base) {
  const text = typeof base === 'string' ? base.trim() : ''
  return text.replace(/\/+$/, '')
}

export function presetDraft (presetId, { base = '', token = '', rate = 1, region = 'cn' } = {}) {
  const draft = baseDraft(token)
  switch (presetId) {
    case 'deepseek':
      return {
        ...draft,
        preset: 'deepseek',
        name: 'DeepSeek',
        url: 'https://api.deepseek.com/user/balance',
        authType: 'bearer',
        balancePath: 'balance_infos[0].total_balance',
        currencyPath: 'balance_infos[0].currency',
        detailPaths: [
          { label: '充值余额', path: 'balance_infos[0].topped_up_balance' },
          { label: '赠送余额', path: 'balance_infos[0].granted_balance' },
        ],
        divisor: 1,
        multiplier: 1,
        symbol: '¥',
        decimals: 2,
      }
    case 'newapi': {
      const clean = newApiBase(base)
      return {
        ...draft,
        preset: 'newapi',
        name: 'new-api 中转',
        url: clean === '' ? '' : `${clean}/api/user/self`,
        authType: 'bearer',
        balancePath: 'data.quota',
        currencyPath: '',
        detailPaths: [{ label: '已用额度', path: 'data.used_quota' }],
        usageUrl: clean === ''
          ? ''
          : `${clean}/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day`,
        usageMethod: 'GET',
        usageArrayPath: 'data',
        usageFields: [
          { label: '近7天 Token', path: 'token_used' },
          { label: '近7天 请求', path: 'count' },
        ],
        usageScale: false,
        divisor: 500000,
        multiplier: normalizeRate(rate),
        symbol: '¥',
        decimals: 2,
        autoUnit: true,
      }
    }
    case 'kimi': {
      const global = region === 'global'
      return {
        ...draft,
        preset: 'kimi',
        region: global ? 'global' : 'cn',
        name: 'Kimi',
        url: global
          ? 'https://api.moonshot.ai/v1/users/me/balance'
          : 'https://api.moonshot.cn/v1/users/me/balance',
        authType: 'bearer',
        balancePath: 'data.available_balance',
        currencyPath: '',
        detailPaths: [
          { label: '代金券', path: 'data.voucher_balance' },
          { label: '现金', path: 'data.cash_balance' },
        ],
        divisor: 1,
        multiplier: 1,
        symbol: global ? '$' : '¥',
        decimals: 2,
        autoUnit: false,
      }
    }
    case 'mimo':
      return {
        ...draft,
        preset: 'mimo',
        name: '小米 MiMo',
        url: 'https://api.xiaomimimo.com/v1/platform/balance',
        authType: 'bearer',
        balancePath: 'balance_infos[0].total_available',
        currencyPath: 'balance_infos[0].currency',
        detailPaths: [
          { label: '现金', path: 'balance_infos[0].cash_balance' },
          { label: '赠送', path: 'balance_infos[0].gift_balance' },
          { label: '冻结', path: 'balance_infos[0].frozen_balance' },
        ],
        divisor: 1,
        multiplier: 1,
        symbol: '¥',
        decimals: 2,
        autoUnit: false,
      }
    case 'custom':
    default:
      return draft
  }
}

export function presetOptions () {
  return [
    ...PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
    { label: '自定义', value: 'custom' },
  ]
}
