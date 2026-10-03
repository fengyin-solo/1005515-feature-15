import {
  STABILITY_PLAN_KEY,
  STABILITY_TERMINAL,
  STABILITY_TIME_POINTS,
  isTimePoint,
  timePointOrder,
} from '@/data/stability'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 稳定性考察的专属业务逻辑：组合检索、排期、签字、单向状态机、幂等登记、动作留痕。
// 通用列表逻辑（local-service）不动，其它模块不受影响。
const MODULE_KEY = 'stability'
const AUDIT_KEY = 'supplieraudit'

export type StabilityQuery = {
  考察编号?: string
  时间点?: string[]
  批号起?: string
  批号止?: string
  page?: number
  size?: number
}

export type StabilitySearchResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  pages: number
  diagnosis: string[]
}

export type RegisterInput = {
  考察编号: string
  考察批号: string
  考察时间点: string
  考察条件?: string
  检验项目?: string
  考察结果?: string
  考察人: string
}

export type PlanInput = {
  考察批号: string
  考察条件?: string
  考察人?: string
  时间点: string[]
}

type Condition = { label: string; test: (row: EntryRow) => boolean }

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function compareBatch(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
}

// 动作落到供应商审计的清单：稳定性考察的每个动作都在供应商审计模块里留一条痕。
function appendAudit(source: Record<string, unknown>, action: string, conclusion: string): string {
  const rows = listRows(AUDIT_KEY)
  const seq =
    rows.reduce((max, row) => {
      const matched = /^AUD-STAB-(\d+)$/.exec(String(row['审计编号'] ?? ''))
      return matched ? Math.max(max, Number(matched[1])) : max
    }, 0) + 1
  const code = `AUD-STAB-${String(seq).padStart(4, '0')}`
  const entry: EntryRow = {
    id: nextId(rows),
    status: '已通过',
    pending: false,
    abnormal: false,
    审计编号: code,
    供应商名称: `稳定性考察·${String(source.考察编号 ?? '')}`,
    物料类别: String(source.考察批号 ?? ''),
    审计方式: action,
    缺陷项数: 0,
    审计结论: conclusion,
    整改期限: today(),
    审计状态: '动作留痕',
  }
  saveRows(AUDIT_KEY, [...rows, entry])
  return code
}

function buildConditions(query: StabilityQuery): Condition[] {
  const conditions: Condition[] = []
  const code = (query.考察编号 ?? '').trim()
  if (code) {
    conditions.push({
      label: `考察编号含「${code}」`,
      test: (row) => String(row['考察编号'] ?? '').includes(code),
    })
  }
  const points = (query.时间点 ?? []).filter((point) => point.trim() !== '')
  if (points.length > 0) {
    conditions.push({
      label: `考察时间点为「${points.join('、')}」`,
      test: (row) => points.includes(String(row['考察时间点'] ?? '')),
    })
  }
  const from = (query.批号起 ?? '').trim()
  if (from) {
    conditions.push({
      label: `考察批号 ≥「${from}」`,
      test: (row) => compareBatch(String(row['考察批号'] ?? ''), from) >= 0,
    })
  }
  const to = (query.批号止 ?? '').trim()
  if (to) {
    conditions.push({
      label: `考察批号 ≤「${to}」`,
      test: (row) => compareBatch(String(row['考察批号'] ?? ''), to) <= 0,
    })
  }
  return conditions
}

// 没命中时说明卡在哪一项：单独就没有命中的条件直接点名；都有命中但交集为空时，找出叠加后清零的那一项。
function diagnose(rows: EntryRow[], conditions: Condition[]): string[] {
  if (conditions.length === 0) {
    return ['没有填任何条件列表也是空的——当前还没有登记任何考察记录，请先登记']
  }
  const soloZero = conditions.filter((condition) => rows.filter(condition.test).length === 0)
  if (soloZero.length > 0) {
    return soloZero.map(
      (condition) => `卡在${condition.label}：单是这一项就没有任何记录命中，放宽它再试`,
    )
  }
  let rest = rows
  for (const condition of conditions) {
    const next = rest.filter(condition.test)
    if (next.length === 0) {
      const solo = rows.filter(condition.test).length
      return [
        `卡在${condition.label}：它单独能命中 ${solo} 条，但和前面的条件叠加取交集后一条不剩，放宽或去掉它再试`,
      ]
    }
    rest = next
  }
  return []
}

// 条件叠加取交集，列表分页；没命中时给出卡在哪一项的说明。
export function searchStability(query: StabilityQuery): StabilitySearchResult {
  const rows = listRows(MODULE_KEY)
  const conditions = buildConditions(query)
  const matched = rows.filter((row) => conditions.every((condition) => condition.test(row)))
  matched.sort((a, b) => {
    const byBatch = compareBatch(String(a['考察批号'] ?? ''), String(b['考察批号'] ?? ''))
    if (byBatch !== 0) return byBatch
    const byCode = String(a['考察编号'] ?? '').localeCompare(String(b['考察编号'] ?? ''))
    if (byCode !== 0) return byCode
    return timePointOrder(String(a['考察时间点'] ?? '')) - timePointOrder(String(b['考察时间点'] ?? ''))
  })
  const size = Math.max(1, Math.floor(query.size ?? 5))
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pages)
  const items = matched.slice((page - 1) * size, page * size)
  const diagnosis = matched.length === 0 ? diagnose(rows, conditions) : []
  return { items, total: matched.length, page, size, pages, diagnosis }
}

export function stabilityStats(): { label: string; value: number }[] {
  const rows = listRows(MODULE_KEY)
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  return [
    { label: '待考察批次', value: count('待考察') },
    { label: '考察中批次', value: count('考察中') },
    { label: '已完成考察数', value: count('已完成') },
    { label: '已终止考察数', value: count('已终止') },
  ]
}

export function listPlans(): EntryRow[] {
  return listRows(STABILITY_PLAN_KEY)
}

export function latestPlan(batch: string): EntryRow | undefined {
  return listPlans().find((plan) => String(plan['考察批号']) === batch)
}

// 考察按批号排期：同一批号重复排期只留最新一版，旧版作废。
export function schedulePlan(input: PlanInput): ActionResult {
  const batch = input.考察批号.trim()
  if (!batch) {
    return { ok: false, message: '考察批号不能为空，排期排不下去' }
  }
  const points = input.时间点.filter((point) => isTimePoint(point))
  if (points.length === 0) {
    return {
      ok: false,
      message: `至少要留一个考察时间点，且只能从标准时间点（${STABILITY_TIME_POINTS.join('、')}）里挑`,
    }
  }
  const plans = listPlans()
  const previous = plans.find((plan) => String(plan['考察批号']) === batch)
  const version = previous ? Number(previous['版本'] ?? 1) + 1 : 1
  const plan: EntryRow = {
    id: previous ? Number(previous.id) : nextId(plans),
    status: '现行',
    pending: false,
    abnormal: false,
    考察批号: batch,
    考察条件: (input.考察条件 ?? '').trim() || '长期 25℃±2℃ / 60%RH±5%RH',
    考察人: (input.考察人 ?? '').trim(),
    计划时间点: points.join('、'),
    版本: version,
    排期日期: today(),
  }
  const next = previous
    ? plans.map((item) => (Number(item.id) === Number(previous.id) ? plan : item))
    : [...plans, plan]
  saveRows(STABILITY_PLAN_KEY, next)
  const conclusion = previous
    ? `批号 ${batch} 的考察计划更新为第 ${version} 版，旧版作废，口径只留最新一版`
    : `批号 ${batch} 新排考察计划（第 1 版），留点取样照此计划走`
  const audit = appendAudit({ 考察编号: `排期·${batch}`, 考察批号: batch }, '考察排期', conclusion)
  return { ok: true, message: `${conclusion}；动作已落到供应商审计清单（${audit}）` }
}

// 登记考察记录：按批号排期是前提，考察时间点越界打回重填；同一份考察重复提交只记一次，内容留最新一版。
export function registerStability(input: RegisterInput): ActionResult {
  const code = input.考察编号.trim()
  const batch = input.考察批号.trim()
  const point = input.考察时间点.trim()
  const person = input.考察人.trim()
  if (!code || !batch || !point || !person) {
    return { ok: false, message: '考察编号、考察批号、考察时间点、考察人都要填，缺项打回重填' }
  }
  if (!isTimePoint(point)) {
    return {
      ok: false,
      message: `考察时间点越界：「${point}」不在标准时间点（${STABILITY_TIME_POINTS.join('、')}）里，已打回，请重填`,
    }
  }
  const plan = latestPlan(batch)
  if (!plan) {
    return { ok: false, message: `批号 ${batch} 还没排期：考察按批号排期，请先在「考察排期」里登记该批号的计划` }
  }
  const planned = String(plan['计划时间点'] ?? '').split('、').filter(Boolean)
  if (!planned.includes(point)) {
    return {
      ok: false,
      message: `考察时间点越界：批号 ${batch} 第 ${plan['版本']} 版计划只排了「${planned.join('、')}」，「${point}」不在计划内，留点取样得照计划走，已打回重填`,
    }
  }
  const condition = (input.考察条件 ?? '').trim() || String(plan['考察条件'] ?? '')
  const item = (input.检验项目 ?? '').trim() || '含量、有关物质'
  const result = (input.考察结果 ?? '').trim() || '—'
  const rows = listRows(MODULE_KEY)
  const duplicate = rows.find(
    (row) => String(row['考察编号']) === code && String(row['考察时间点']) === point,
  )
  if (duplicate) {
    const version = Number(duplicate['版本'] ?? 1) + 1
    const batchNote =
      String(duplicate['考察批号']) === batch
        ? ''
        : `；考察批号口径统一为最新一版：${String(duplicate['考察批号'])} → ${batch}`
    const updated: EntryRow = {
      ...duplicate,
      考察批号: batch,
      考察条件: condition,
      检验项目: item,
      考察结果: result,
      考察人: person,
      版本: version,
    }
    saveRows(MODULE_KEY, rows.map((row) => (Number(row.id) === Number(duplicate.id) ? updated : row)))
    const audit = appendAudit(updated, '重复提交覆盖', `${code}·${point} 重复提交，只记一次，内容覆盖为第 ${version} 版`)
    return {
      ok: true,
      message: `同一份考察重复提交只记一次：${code}·${point} 已有记录，没有新增重复行，内容已按最新一版（第 ${version} 版）覆盖${batchNote}；动作已落到供应商审计清单（${audit}）`,
    }
  }
  const row: EntryRow = {
    id: nextId(rows),
    status: '待考察',
    pending: true,
    abnormal: false,
    考察编号: code,
    考察批号: batch,
    考察条件: condition,
    考察时间点: point,
    检验项目: item,
    考察结果: result,
    考察人: person,
    考察状态: '待考察',
    签字人: '',
    签字时间: '',
    版本: 1,
  }
  saveRows(MODULE_KEY, [...rows, row])
  const audit = appendAudit(row, '登记考察', `${code}·${point} 登记考察记录，状态「待考察」`)
  return { ok: true, message: `考察记录 ${code}·${point} 已登记，状态「待考察」；动作已落到供应商审计清单（${audit}）` }
}

// 考察人要签字：只有考察中才能签，签过不再重复记。
export function signStability(id: number, signer: string): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的考察记录` }
  }
  const row = rows[index]
  const label = `${String(row['考察编号'])}·${String(row['考察时间点'])}`
  if (String(row.status) !== '考察中') {
    return { ok: false, message: `只有「考察中」的记录才能签字，${label} 当前是「${String(row.status)}」` }
  }
  if (String(row['签字人'] ?? '').trim() !== '') {
    return { ok: false, message: `${label} 已由 ${String(row['签字人'])} 签过字，重复签字不再记` }
  }
  const updated: EntryRow = { ...row, 签字人: signer, 签字时间: today() }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  const audit = appendAudit(updated, '考察人签字', `${label} 考察人签字（签字人：${signer}）`)
  return { ok: true, message: `${label} 考察人签字已登记（签字人：${signer}）；动作已落到供应商审计清单（${audit}）` }
}

// 状态只能单向流转：待考察 → 考察中 → 已完成，已终止为终态；跨级、回退一律拦下。
export function transitionStability(id: number, action: string): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的考察记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  const label = `${String(row['考察编号'])}·${String(row['考察时间点'])}`

  const apply = (target: string, abnormal: boolean, note: string): ActionResult => {
    const updated: EntryRow = {
      ...row,
      status: target,
      考察状态: target,
      pending: !(STABILITY_TERMINAL as readonly string[]).includes(target),
      abnormal,
    }
    const next = [...rows]
    next[index] = updated
    saveRows(MODULE_KEY, next)
    const audit = appendAudit(updated, action, `${label} ${note}，考察状态「${current}」→「${target}」`)
    return { ok: true, message: `${label} ${note}，当前状态「${target}」；动作已落到供应商审计清单（${audit}）` }
  }

  if (action === '提交考察') {
    if (current === '待考察') {
      return apply('考察中', false, '已提交考察')
    }
    if (current === '考察中') {
      return { ok: false, message: `${label} 已经在「考察中」，不用重复提交` }
    }
    return { ok: false, message: `状态只能单向流转：${label} 当前「${current}」，不能回头「提交考察」` }
  }
  if (action === '确认完成') {
    if (current === '待考察') {
      return { ok: false, message: `跨级操作已拦下：${label} 还在「待考察」，不能直接「确认完成」，请先「提交考察」` }
    }
    if (current === '已完成') {
      return { ok: false, message: `${label} 已经「已完成」，不用重复确认` }
    }
    if (current === '已终止') {
      return { ok: false, message: `状态只能单向流转：${label} 已终止，不能再「确认完成」` }
    }
    if (String(row['签字人'] ?? '').trim() === '') {
      return { ok: false, message: `考察人还没签字，${label} 不能「确认完成」，请先完成考察人签字` }
    }
    return apply('已完成', false, '考察完成')
  }
  if (action === '终止考察') {
    if (current === '已终止') {
      return { ok: false, message: `${label} 已经「已终止」，不用重复终止` }
    }
    if (current === '已完成') {
      return { ok: false, message: `状态只能单向流转：${label} 已完成，不能再「终止考察」` }
    }
    return apply('已终止', true, '考察终止')
  }
  return { ok: false, message: `稳定性考察没有登记「${action}」这个动作` }
}

export function resetStability(): void {
  resetRows(MODULE_KEY)
  resetRows(STABILITY_PLAN_KEY)
}
