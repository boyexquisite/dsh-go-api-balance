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
    extraUrl: '',
    extraFields: [],
    divisor: 1,
    multiplier: 1,
    symbol: '¥',
    decimals: 2,
    enabled: true,
    autoUnit: false,
    balanceOptional: false,
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

// new-api 订阅额度：独立接口 /api/subscription/self（不是 /api/user/self 的字段）。
// amount_total/amount_used 与 quota 同单位（quota），成交给展示层的 unit 换算。
const MAX_SUBSCRIPTIONS = 'data.subscriptions'
export function newapiSubscriptionFields (base) {
  const clean = newApiBase(base)
  if (clean === '') return { extraUrl: '', extraFields: [] }
  return {
    extraUrl: `${clean}/api/subscription/self`,
    // 顺序有讲究：卡片只显示前两条附加信息，到期放第二位才能出现在卡片上。
    extraFields: [
      {
        label: '订阅剩余',
        path: `${MAX_SUBSCRIPTIONS}[].subscription.amount_total - ${MAX_SUBSCRIPTIONS}[].subscription.amount_used`,
      },
      { label: '订阅到期', path: 'data.subscriptions[0].subscription.end_time', kind: 'date' },
      { label: '订阅总量', path: `${MAX_SUBSCRIPTIONS}[].subscription.amount_total` },
      { label: '订阅已用', path: `${MAX_SUBSCRIPTIONS}[].subscription.amount_used` },
    ],
  }
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
        detailPaths: [
          { label: '已用额度', path: 'data.used_quota' },
          { label: '累计请求', path: 'data.request_count', kind: 'count' },
          { label: '用户组', path: 'data.group', kind: 'text' },
        ],
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
        ...newapiSubscriptionFields(clean),
      }
    }
    case 'oneapi': {
      const clean = newApiBase(base)
      return {
        ...draft,
        preset: 'oneapi',
        name: 'one-api 中转',
        url: clean === '' ? '' : `${clean}/api/user/self`,
        authType: 'bearer',
        balancePath: 'data.quota',
        currencyPath: '',
        detailPaths: [
          { label: '已用额度', path: 'data.used_quota' },
          { label: '累计请求', path: 'data.request_count', kind: 'count' },
          { label: '用户组', path: 'data.group', kind: 'text' },
        ],
        // one-api 没有 /api/data/self；自带近 7 天 dashboard（固定窗口）。
        usageUrl: clean === '' ? '' : `${clean}/api/user/dashboard`,
        usageMethod: 'GET',
        usageArrayPath: 'data',
        usageFields: [
          { label: '近7天 Token', path: 'prompt_tokens + completion_tokens' },
          { label: '近7天 请求', path: 'request_count' },
        ],
        usageScale: false,
        divisor: 500000,
        multiplier: normalizeRate(rate),
        symbol: '$',
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
        // total_available 含授信额度，不等于自己的钱；余额只算现金 + 赠送。
        balancePath: 'balance_infos[0].cash_balance + balance_infos[0].gift_balance',
        currencyPath: 'balance_infos[0].currency',
        detailPaths: [
          { label: '现金', path: 'balance_infos[0].cash_balance' },
          { label: '赠送', path: 'balance_infos[0].gift_balance' },
          { label: '冻结', path: 'balance_infos[0].frozen_balance' },
          { label: '授信可用', path: 'balance_infos[0].credit_available' },
        ],
        divisor: 1,
        multiplier: 1,
        symbol: '¥',
        decimals: 2,
        autoUnit: false,
      }
    case 'openrouter':
      return {
        ...draft,
        preset: 'openrouter',
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/key',
        authType: 'bearer',
        balancePath: 'data.limit_remaining',
        balanceOptional: true,
        currencyPath: '',
        usageUrl: '',
        usageArrayPath: '',
        usageFields: [
          { label: '今日花费', path: 'data.usage_daily' },
          { label: '本月花费', path: 'data.usage_monthly' },
        ],
        detailPaths: [
          { label: '本周花费', path: 'data.usage_weekly' },
          { label: '累计花费', path: 'data.usage' },
          { label: '消费限额', path: 'data.limit' },
          { label: '限额重置', path: 'data.limit_reset', kind: 'date' },
        ],
        usageScale: true,
        divisor: 1,
        multiplier: 1,
        symbol: '$',
        decimals: 2,
        autoUnit: false,
      }
    case 'openai-cost':
      return {
        ...draft,
        preset: 'openai-cost',
        name: 'OpenAI 花费',
        url: 'https://api.openai.com/v1/organization/costs?start_time={month_start}&end_time={now}&bucket_width=1d&limit=31',
        authType: 'bearer',
        balancePath: '',
        balanceOptional: false,
        usageUrl: '',
        usageArrayPath: '',
        usageFields: [{ label: '本月花费', path: 'data[].results[].amount.value' }],
        usageScale: true,
        // 同一个 Admin key 再查一次组织用量，把 token 数也显示出来（失败静默）。
        extraUrl: 'https://api.openai.com/v1/organization/usage/completions?start_time={month_start}&end_time={now}&bucket_width=1d&limit=31',
        extraFields: [
          { label: '本月输入 Token', path: 'data[].results[].input_tokens', kind: 'count' },
          { label: '本月输出 Token', path: 'data[].results[].output_tokens', kind: 'count' },
          { label: '本月请求数', path: 'data[].results[].num_model_requests', kind: 'count' },
        ],
        divisor: 1,
        multiplier: 1,
        symbol: '$',
        decimals: 2,
        autoUnit: false,
      }
    case 'anthropic-cost':
      return {
        ...draft,
        preset: 'anthropic-cost',
        name: 'Claude 花费',
        // cost_report 默认只返回 7 个日桶，必须 limit=31 才能覆盖整月。
        url: 'https://api.anthropic.com/v1/organizations/cost_report?starting_at={month_start_iso}&ending_at={now_iso}&bucket_width=1d&limit=31',
        authType: 'header',
        secretHeader: 'x-api-key',
        headersText: JSON.stringify({ 'anthropic-version': '2023-06-01' }),
        balancePath: '',
        balanceOptional: false,
        usageUrl: '',
        usageArrayPath: '',
        usageFields: [{ label: '本月花费', path: 'data[].results[].amount' }],
        usageScale: true,
        // 同一个 Admin key 再查一次 usage_report/messages，补 token 与缓存用量（失败静默）。
        extraUrl: 'https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at={month_start_iso}&ending_at={now_iso}&bucket_width=1d&limit=31',
        extraFields: [
          { label: '本月输入 Token', path: 'data[].results[].input_tokens', kind: 'count' },
          { label: '本月输出 Token', path: 'data[].results[].output_tokens', kind: 'count' },
          { label: '缓存读 Token', path: 'data[].results[].cache_read_input_tokens', kind: 'count' },
          { label: '缓存写 Token', path: 'data[].results[].cache_creation.ephemeral_5m_input_tokens', kind: 'count' },
        ],
        divisor: 100,
        multiplier: 1,
        symbol: '$',
        decimals: 2,
        autoUnit: false,
      }
    case 'opencode-go':
      return {
        ...draft,
        preset: 'opencode-go',
        name: 'OpenCode Go',
        url: 'https://opencode.ai/zen/go/v1/usage',
        authType: 'bearer',
        // 接口给的是「已用百分比」，卡片显示滚动窗口的剩余百分比。
        balancePath: '100 - usage.rolling.percent',
        currencyPath: '',
        detailPaths: [
          { label: '5小时重置', path: 'usage.rolling.resetsAt', kind: 'date' },
          { label: '本周重置', path: 'usage.weekly.resetsAt', kind: 'date' },
          { label: '本月重置', path: 'usage.monthly.resetsAt', kind: 'date' },
        ],
        usageFields: [
          { label: '本周剩余%', path: '100 - usage.weekly.percent' },
          { label: '本月剩余%', path: '100 - usage.monthly.percent' },
        ],
        usageScale: false,
        divisor: 1,
        multiplier: 1,
        symbol: '%',
        decimals: 0,
        autoUnit: false,
      }
    case 'commandcode':
      return {
        ...draft,
        preset: 'commandcode',
        name: 'Command Code',
        url: 'https://api.commandcode.ai/alpha/billing/credits',
        authType: 'bearer',
        balancePath: 'credits.monthlyCredits',
        currencyPath: '',
        detailPaths: [
          { label: '本月额度', path: 'credits.monthlyCreditsGranted' },
          { label: '5小时已用', path: 'credits.windowLimits.fiveHour.used' },
          { label: '本周已用', path: 'credits.windowLimits.weekly.used' },
          { label: '5小时重置', path: 'credits.windowLimits.fiveHour.resetAt', kind: 'date' },
          { label: '本周重置', path: 'credits.windowLimits.weekly.resetAt', kind: 'date' },
        ],
        usageFields: [
          {
            label: '5小时剩余',
            path: 'credits.windowLimits.fiveHour.cap - credits.windowLimits.fiveHour.used',
          },
          {
            label: '本周剩余',
            path: 'credits.windowLimits.weekly.cap - credits.windowLimits.weekly.used',
          },
        ],
        usageScale: true,
        divisor: 1,
        multiplier: 1,
        symbol: '$',
        decimals: 2,
        autoUnit: false,
      }
    case 'custom':
    default:
      return draft
  }
}
