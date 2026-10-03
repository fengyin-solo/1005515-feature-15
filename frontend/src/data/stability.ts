// 稳定性考察的公共口径。
// 考察时间点全系统只有这一套：搜索条件、登记表单、排期表单都从这里取，保证两处拿到的为同一套。
export const STABILITY_TIME_POINTS = ['0月', '3月', '6月', '9月', '12月', '18月', '24月'] as const

// 考察状态只许单向流转：待考察 → 考察中 → 已完成；已终止是终态，到哪都不能再动。
export const STABILITY_FLOW = ['待考察', '考察中', '已完成'] as const
export const STABILITY_TERMINAL = ['已完成', '已终止'] as const

// 排期计划存在同一个本地仓库里。考察批号是计划的唯一键，同一批号重排只留最新一版。
export const STABILITY_PLAN_KEY = 'stability-plans'

export function isTimePoint(value: string): boolean {
  return (STABILITY_TIME_POINTS as readonly string[]).includes(value)
}

export function timePointOrder(value: string): number {
  const index = (STABILITY_TIME_POINTS as readonly string[]).indexOf(value)
  return index < 0 ? STABILITY_TIME_POINTS.length : index
}
