import type { EntryRow } from './types'

// 稳定性考察的统一口径：时间点、结果、批号版本、状态流转规则全部收口在这一处。
// 搜索栏和登记表单共用同一套常量，保证「考察时间点两处拿到的为同一套」。

/** 计划内考察时间点：超出这套清单的时间点一律视为越界，登记表单打回重填。 */
export const STABILITY_TIME_POINTS: readonly string[] = [
  '0月',
  '3月',
  '6月',
  '9月',
  '12月',
  '18月',
  '24月',
  '36月',
]

/** 考察结果候选项：搜索时可多选，条件之间取交集，多个结果之间取并集。 */
export const STABILITY_RESULTS: readonly string[] = [
  '待出结果',
  '合格',
  '不合格',
  'OOS调查中',
]

/** 留样取样是否按考察方案执行：不按计划的留样不允许提交考察。 */
export const SAMPLING_STATUS: readonly string[] = ['按计划', '偏离计划']

export const STABILITY_STATUSES: readonly string[] = ['待考察', '考察中', '已完成', '已终止']

/**
 * 状态只能单向逐级流转：键为当前状态，值为该状态下允许执行的动作及其目标状态。
 * 不在表里的动作一律拦下——回退、跨级、重复提交都进不来。
 */
export const STABILITY_TRANSITIONS: Record<string, Record<string, string>> = {
  待考察: { 提交考察: '考察中' },
  考察中: { 确认完成: '已完成', 终止考察: '已终止' },
  已完成: {},
  已终止: {},
}

/** 每个动作正常要落到的目标状态，用于跨级拦截时给出明确提示。 */
export const ACTION_TARGETS: Record<string, string> = Object.values(
  STABILITY_TRANSITIONS,
).reduce<Record<string, string>>((acc, map) => ({ ...acc, ...map }), {})

export type BatchInfo = {
  raw: string
  base: string
  version: number
}

const BATCH_PATTERN = /^(.+?)-V(\d+)$/

/** 解析「基础批号-V版本号」；没有版本后缀的按第 1 版处理。 */
export function parseBatch(raw: string): BatchInfo {
  const text = raw.trim()
  const matched = BATCH_PATTERN.exec(text)
  if (!matched) {
    return { raw: text, base: text, version: 1 }
  }
  return { raw: text, base: matched[1], version: Number(matched[2]) }
}

export function formatBatch(base: string, version: number): string {
  return `${base}-V${version}`
}

export function timePointOrder(timePoint: string): number {
  const index = STABILITY_TIME_POINTS.indexOf(timePoint)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * 批号口径统一：同一基础批号只留最新一版，旧版整组折叠掉。
 * 例如 B202601-V1 与 B202601-V2 同时存在时，V1 的全部时间点都不进列表。
 */
export function latestVersionRows(rows: EntryRow[]): EntryRow[] {
  const maxVersion = new Map<string, number>()
  for (const row of rows) {
    const info = parseBatch(String(row['考察批号'] ?? ''))
    maxVersion.set(info.base, Math.max(maxVersion.get(info.base) ?? 0, info.version))
  }
  return rows.filter((row) => {
    const info = parseBatch(String(row['考察批号'] ?? ''))
    return info.version === (maxVersion.get(info.base) ?? info.version)
  })
}

/** 考察按批号排期：先按基础批号，再按计划时间点先后，同点内按登记次序。 */
export function sortBySchedule(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const batchA = parseBatch(String(a['考察批号'] ?? ''))
    const batchB = parseBatch(String(b['考察批号'] ?? ''))
    if (batchA.base !== batchB.base) {
      return batchA.base.localeCompare(batchB.base, 'zh-Hans-CN')
    }
    const pointGap =
      timePointOrder(String(a['考察时间点'] ?? '')) - timePointOrder(String(b['考察时间点'] ?? ''))
    if (pointGap !== 0) {
      return pointGap
    }
    return Number(a.id) - Number(b.id)
  })
}
