import { listRows, saveRows } from '@/data/local-store'
import {
  ACTION_TARGETS,
  STABILITY_RESULTS,
  STABILITY_TIME_POINTS,
  STABILITY_TRANSITIONS,
  latestVersionRows,
  parseBatch,
  sortBySchedule,
} from '@/data/stability-rules'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

const MODULE_KEY = 'stability'
const SUPPLIER_KEY = 'supplieraudit'

/** 列表每页条数：数据多了就翻页，不再从头拉一遍。 */
export const STABILITY_PAGE_SIZE = 6

export type StabilityQuery = {
  code: string
  batchStart: string
  batchEnd: string
  timePoint: string
  results: string[]
}

export type CheckStage = {
  key: string
  label: string
  active: boolean
  passed: boolean
  count: number
  detail: string
}

export type StabilityPage = PageResult & {
  stages: CheckStage[]
  blockedStage?: string
}

export function emptyStabilityQuery(): StabilityQuery {
  return { code: '', batchStart: '', batchEnd: '', timePoint: '', results: [] }
}

/** 每个动作落地到供应商审计清单时的口径。 */
const AUDIT_LANDING: Record<
  string,
  { way: string; defects: (row: EntryRow) => number; conclusion: (row: EntryRow) => string }
> = {
  提交考察: {
    way: '资料审查',
    defects: () => 0,
    conclusion: (row) =>
      `稳定性考察进入考察中（${row['考察批号']} · ${row['考察时间点']}），纳入供应商审计跟踪清单`,
  },
  确认完成: {
    way: '现场复核',
    defects: (row) => (String(row['考察结果']) === '合格' ? 0 : 1),
    conclusion: (row) =>
      `稳定性考察已完成，结果「${row['考察结果']}」，请复核供应商质量（${row['考察批号']} · ${row['考察时间点']}）`,
  },
  终止考察: {
    way: '风险评估',
    defects: () => 1,
    conclusion: (row) =>
      `稳定性考察已终止（${row['考察批号']} · ${row['考察时间点']}），需评估对供应商的影响`,
  },
}

function withinBatchRange(raw: string, start: string, end: string): boolean {
  const base = parseBatch(raw).base
  if (start && base < start) {
    return false
  }
  if (end && base > end) {
    return false
  }
  return true
}

/**
 * 条件搜索：每一项条件都是一道关卡，逐道取交集。
 * 没命中时按关卡顺序指出第一条把结果筛没的条件，告诉用户卡在哪一项。
 */
export function queryStability(
  query: StabilityQuery,
  page = 1,
): StabilityPage {
  const all = listRows(MODULE_KEY)
  const foldedCount = all.length - latestVersionRows(all).length
  const stages: CheckStage[] = []

  // 第 0 道：批号口径——同一基础批号只留最新一版，始终生效。
  let pipeline = sortBySchedule(latestVersionRows(all))
  stages.push({
    key: 'version',
    label: '批号口径（只留最新版）',
    active: true,
    passed: pipeline.length > 0,
    count: pipeline.length,
    detail:
      foldedCount > 0
        ? `已折叠旧版批号 ${foldedCount} 条，剩余 ${pipeline.length} 条`
        : `无旧版批号需要折叠，共 ${pipeline.length} 条`,
  })

  const code = query.code.trim()
  if (code) {
    pipeline = pipeline.filter((row) => String(row['考察编号'] ?? '').includes(code))
    stages.push({
      key: 'code',
      label: `考察编号含「${code}」`,
      active: true,
      passed: pipeline.length > 0,
      count: pipeline.length,
      detail:
        pipeline.length > 0
          ? `命中 ${pipeline.length} 条`
          : `没有考察编号含「${code}」的记录，卡在此项`,
    })
  }

  const start = query.batchStart.trim()
  const end = query.batchEnd.trim()
  if (start || end) {
    const invalid = start && end && start > end
    pipeline = invalid
      ? []
      : pipeline.filter((row) => withinBatchRange(String(row['考察批号'] ?? ''), start, end))
    const rangeText = `${start || '不限'} ～ ${end || '不限'}`
    stages.push({
      key: 'batchRange',
      label: `考察批号区间 ${rangeText}`,
      active: true,
      passed: !invalid && pipeline.length > 0,
      count: pipeline.length,
      detail: invalid
        ? `区间无效：起始批号「${start}」晚于截止批号「${end}」，请调整后重查，卡在此项`
        : pipeline.length > 0
          ? `区间内 ${pipeline.length} 条`
          : `批号区间 ${rangeText} 内没有记录，卡在此项`,
    })
  }

  if (query.timePoint) {
    pipeline = pipeline.filter((row) => String(row['考察时间点'] ?? '') === query.timePoint)
    stages.push({
      key: 'timePoint',
      label: `考察时间点＝${query.timePoint}`,
      active: true,
      passed: pipeline.length > 0,
      count: pipeline.length,
      detail:
        pipeline.length > 0
          ? `该时间点 ${pipeline.length} 条`
          : `没有「${query.timePoint}」时间点的记录，卡在此项`,
    })
  }

  if (query.results.length > 0) {
    const wanted = new Set(query.results)
    pipeline = pipeline.filter((row) => wanted.has(String(row['考察结果'] ?? '')))
    const label = query.results.join('、')
    stages.push({
      key: 'results',
      label: `考察结果：${label}`,
      active: true,
      passed: pipeline.length > 0,
      count: pipeline.length,
      detail:
        pipeline.length > 0
          ? `结果符合 ${pipeline.length} 条`
          : `没有结果为「${label}」的记录，卡在此项`,
    })
  }

  const totalPages = Math.max(1, Math.ceil(pipeline.length / STABILITY_PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const items = pipeline.slice(
    (currentPage - 1) * STABILITY_PAGE_SIZE,
    currentPage * STABILITY_PAGE_SIZE,
  )
  const blockedStage = stages.find((stage) => stage.active && !stage.passed)?.key

  return {
    items,
    total: pipeline.length,
    page: currentPage,
    size: STABILITY_PAGE_SIZE,
    stages,
    blockedStage,
  }
}

export type StabilityDraft = {
  考察编号: string
  考察批号: string
  供应商: string
  考察条件: string
  考察时间点: string
  检验项目: string
  考察结果: string
  留样取样: string
  考察人: string
  考察人签字: string
}

const REQUIRED_FIELDS: { key: keyof StabilityDraft; label: string }[] = [
  { key: '考察编号', label: '考察编号' },
  { key: '考察批号', label: '考察批号' },
  { key: '供应商', label: '供应商' },
  { key: '考察条件', label: '考察条件' },
  { key: '考察时间点', label: '考察时间点' },
  { key: '检验项目', label: '检验项目' },
  { key: '考察人', label: '考察人' },
  { key: '考察人签字', label: '考察人签字' },
]

/**
 * 登记稳定性考察。越界时间点打回重填；同一份考察重复提交只记一次；
 * 同批号同时间点已有不低于本次版本的记录时，不允许再次登记。
 */
export function createStability(input: StabilityDraft): ActionResult {
  for (const field of REQUIRED_FIELDS) {
    if (!String(input[field.key] ?? '').trim()) {
      return { ok: false, message: `「${field.label}」为必填项，请补齐后再提交` }
    }
  }

  const rows = listRows(MODULE_KEY)
  const code = input.考察编号.trim()
  if (rows.some((row) => String(row['考察编号']) === code)) {
    return {
      ok: false,
      message: `考察编号「${code}」已登记过，同一份考察重复提交只记一次`,
    }
  }

  if (!STABILITY_TIME_POINTS.includes(input.考察时间点.trim())) {
    return {
      ok: false,
      message: `考察时间点「${input.考察时间点}」越界，只允许按计划填写：${STABILITY_TIME_POINTS.join(
        '、',
      )}，请重填`,
    }
  }

  const result = STABILITY_RESULTS.includes(input.考察结果) ? input.考察结果 : '待出结果'
  const sampling = input.留样取样 === '偏离计划' ? '偏离计划' : '按计划'
  const batch = parseBatch(input.考察批号)
  const samePoint = rows.filter(
    (row) =>
      parseBatch(String(row['考察批号'])).base === batch.base &&
      String(row['考察时间点']) === input.考察时间点.trim(),
  )
  const latestVersion = samePoint.reduce(
    (max, row) => Math.max(max, parseBatch(String(row['考察批号'])).version),
    0,
  )
  if (samePoint.length > 0 && batch.version <= latestVersion) {
    return {
      ok: false,
      message: `批号「${batch.base}」在「${input.考察时间点.trim()}」已有第${latestVersion}版考察记录，重复内容不另登记；确需修订请使用更高版本号`,
    }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const entry: EntryRow = {
    id: nextId,
    status: '待考察',
    pending: true,
    abnormal: false,
    考察编号: code,
    考察批号: batch.raw,
    供应商: input.供应商.trim(),
    考察条件: input.考察条件.trim(),
    考察时间点: input.考察时间点.trim(),
    检验项目: input.检验项目.trim(),
    考察结果: result,
    留样取样: sampling,
    考察人: input.考察人.trim(),
    考察人签字: input.考察人签字.trim(),
  }
  saveRows(MODULE_KEY, [...rows, entry])
  return { ok: true, message: `稳定性考察「${code}」已登记，状态为「待考察」，按批号排入考察计划` }
}

function previousStatusOf(action: string): string | undefined {
  for (const [status, actions] of Object.entries(STABILITY_TRANSITIONS)) {
    if (actions[action]) {
      return status
    }
  }
  return undefined
}

/** 把考察动作落到供应商审计清单；同一动作对同一份考察只落一条。 */
function landToSupplierAudit(action: string, source: EntryRow): string {
  const rows = listRows(SUPPLIER_KEY)
  const ref = String(source['考察编号'])
  const sourceTag = `稳定性考察:${action}`
  if (rows.some((row) => row['联动来源'] === sourceTag && row['关联单号'] === ref)) {
    return ''
  }

  const landing = AUDIT_LANDING[action]
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const auditCode = `SUPP-STAB-${String(nextId).padStart(3, '0')}`
  const entry: EntryRow = {
    id: nextId,
    status: '待审计',
    pending: true,
    abnormal: false,
    审计编号: auditCode,
    供应商名称: String(source['供应商'] ?? '—'),
    物料类别: '稳定性考察物料',
    审计方式: landing.way,
    缺陷项数: landing.defects(source),
    审计结论: landing.conclusion(source),
    整改期限: '—',
    审计状态: '待审计',
    关联单号: ref,
    联动来源: sourceTag,
  }
  saveRows(SUPPLIER_KEY, [...rows, entry])
  return auditCode
}

/**
 * 执行考察动作。状态单向逐级流转：回退、跨级、重复动作一律拦下；
 * 提交前校验留样是否照计划走，完成前校验考察人签字；动作同步落到供应商审计清单。
 */
export function runStabilityAction(id: number, action: string): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的稳定性考察记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  const target = STABILITY_TRANSITIONS[current]?.[action]
  if (!target) {
    const expected = ACTION_TARGETS[action]
    if (!expected) {
      return { ok: false, message: `稳定性考察没有登记「${action}」这个动作` }
    }
    if (current === expected) {
      return { ok: false, message: `该考察已是「${expected}」状态，重复提交只记一次，无需再次操作` }
    }
    const pre = previousStatusOf(action)
    return {
      ok: false,
      message: `状态只能单向逐级流转：「${current}」不能直接执行「${action}」${
        pre ? `（须先处于「${pre}」）` : ''
      }，跨级操作已拦下`,
    }
  }

  if (action === '提交考察' && String(row['留样取样'] ?? '') !== '按计划') {
    return {
      ok: false,
      message: `留样取样偏离考察方案（${row['考察批号']} · ${row['考察时间点']}），请按计划重新取样后再提交考察`,
    }
  }
  if (action === '确认完成' && !String(row['考察人签字'] ?? '').trim()) {
    return {
      ok: false,
      message: `考察人尚未签字（${row['考察批号']} · ${row['考察时间点']}），签字后才能确认完成`,
    }
  }

  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target === '考察中',
    abnormal: target === '已终止',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)

  const auditCode = landToSupplierAudit(action, updated)
  const landed = auditCode ? `；动作已落到供应商审计清单（${auditCode}）` : '；供应商审计清单已有同动作记录，不重复落地'
  return { ok: true, message: `考察「${row['考察编号']}」已${action}，当前状态「${target}」${landed}` }
}

export const STABILITY_EXPORT_COLUMNS = [
  '考察编号',
  '考察批号',
  '供应商',
  '考察条件',
  '考察时间点',
  '检验项目',
  '考察结果',
  '留样取样',
  '考察人',
  '考察人签字',
]

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 导出口径与列表一致：先折叠旧版批号，再按批号排期排序。 */
export function exportStability(): { filename: string; content: string } {
  const rows = sortBySchedule(latestVersionRows(listRows(MODULE_KEY)))
  const lines = [['编号', ...STABILITY_EXPORT_COLUMNS, '当前状态'].map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [row.id, ...STABILITY_EXPORT_COLUMNS.map((field) => row[field] ?? ''), row.status]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '稳定性考察-清单.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadStability(): void {
  const { filename, content } = exportStability()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function stabilityStatusCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of latestVersionRows(listRows(MODULE_KEY))) {
    const status = String(row.status)
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}
