// 内置模板：DeepSeek 官方 / new-api 中转 / 自定义。
export const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek 官方' },
  { id: 'newapi', label: 'new-api / one-api 中转' },
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
    divisor: 1,
    multiplier: 1,
    symbol: '¥',
    decimals: 2,
    enabled: true,
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

export function presetDraft (presetId, { base = '', token = '', rate = 1 } = {}) {
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
        divisor: 500000,
        multiplier: normalizeRate(rate),
        symbol: '¥',
        decimals: 2,
      }
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
