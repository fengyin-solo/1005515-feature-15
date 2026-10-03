<template>
  <section class="page" data-module="stability">
    <header class="page-head">
      <div>
        <h2>稳定性考察管理</h2>
        <p class="page-desc">
          考察按批号排期、留点取样照计划走、考察人签字后确认完成；状态单向流转，动作留痕到供应商审计清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleForm('register')">登记考察记录</button>
        <button class="btn" type="button" @click="toggleForm('plan')">考察排期</button>
        <button class="btn" type="button" @click="exportRows">导出稳定性考察清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="message" class="ok-text">{{ message }}</p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <form v-if="activeForm === 'register'" class="panel" @submit.prevent="submitRegister">
      <h3>登记考察记录</h3>
      <div class="form-grid">
        <label>
          <span>考察编号</span>
          <input v-model="registerForm.考察编号" placeholder="如 STAB-2026-005" />
        </label>
        <label>
          <span>考察批号（已排期）</span>
          <select v-model="registerForm.考察批号" @change="onPlanBatchChange">
            <option value="">请选择已排期批号</option>
            <option v-for="plan in plans" :key="String(plan.id)" :value="String(plan.考察批号)">
              {{ plan.考察批号 }}（第{{ plan.版本 }}版计划：{{ plan.计划时间点 }}）
            </option>
          </select>
        </label>
        <label>
          <span>考察时间点</span>
          <select v-model="registerForm.考察时间点">
            <option value="">请选择考察时间点</option>
            <option v-for="point in timePoints" :key="point" :value="point">{{ point }}</option>
          </select>
        </label>
        <label>
          <span>考察条件</span>
          <input v-model="registerForm.考察条件" placeholder="默认取排期计划里的条件" />
        </label>
        <label>
          <span>检验项目</span>
          <input v-model="registerForm.检验项目" placeholder="如 含量、有关物质" />
        </label>
        <label>
          <span>考察结果</span>
          <input v-model="registerForm.考察结果" placeholder="未出结果可留空" />
        </label>
        <label>
          <span>考察人</span>
          <input v-model="registerForm.考察人" placeholder="默认取排期计划里的考察人" />
        </label>
      </div>
      <p class="panel-hint">
        考察时间点与上方搜索条件用的是同一套口径；不在该批号计划内的时间点会被打回重填；同一份考察重复提交只记一次。
      </p>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交登记</button>
        <button class="btn ghost" type="button" @click="activeForm = ''">收起</button>
      </div>
    </form>

    <form v-if="activeForm === 'plan'" class="panel" @submit.prevent="submitPlan">
      <h3>考察排期（按批号）</h3>
      <div class="form-grid">
        <label>
          <span>考察批号</span>
          <input v-model="planForm.考察批号" placeholder="如 B2026-006" />
        </label>
        <label>
          <span>考察条件</span>
          <input v-model="planForm.考察条件" placeholder="如 长期 25℃±2℃ / 60%RH±5%RH" />
        </label>
        <label>
          <span>考察人</span>
          <input v-model="planForm.考察人" placeholder="负责该批考察的人" />
        </label>
      </div>
      <div class="check-group">
        <span class="check-title">计划时间点（留点取样照此计划走）：</span>
        <label v-for="point in timePoints" :key="point" class="check-item">
          <input v-model="planForm.时间点" type="checkbox" :value="point" /> {{ point }}
        </label>
      </div>
      <p class="panel-hint">同一批号重复排期只留最新一版，旧版自动作废。</p>
      <div class="panel-actions">
        <button class="btn primary" type="submit">保存排期</button>
        <button class="btn ghost" type="button" @click="activeForm = ''">收起</button>
      </div>
    </form>

    <form class="filter-bar" @submit.prevent="applySearch">
      <label class="filter-item">
        <span>考察编号</span>
        <input v-model="query.考察编号" placeholder="按考察编号检索" />
      </label>
      <label class="filter-item">
        <span>考察批号起</span>
        <input v-model="query.批号起" placeholder="如 B2026-001" />
      </label>
      <label class="filter-item">
        <span>考察批号止</span>
        <input v-model="query.批号止" placeholder="如 B2026-004" />
      </label>
      <div class="filter-item">
        <span>考察时间点（可多挑几个）</span>
        <div class="check-group">
          <label v-for="point in timePoints" :key="point" class="check-item">
            <input v-model="query.时间点" type="checkbox" :value="point" /> {{ point }}
          </label>
        </div>
      </div>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetQuery">重置条件</button>
    </form>

    <div v-if="diagnosis.length" class="diagnosis">
      <strong>没有命中记录，卡在哪一项：</strong>
      <p v-for="line in diagnosis" :key="line">{{ line }}</p>
    </div>

    <p v-if="selectedIds.length" class="selection-bar">
      <span>结果里已挑 {{ selectedIds.length }} 条</span>
      <button class="link" type="button" @click="batchSign">批量签字</button>
      <button class="link" type="button" @click="selectedIds = []">清空选择</button>
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
          <th>考察编号</th>
          <th>考察批号</th>
          <th>考察条件</th>
          <th>考察时间点</th>
          <th>检验项目</th>
          <th>考察结果</th>
          <th>考察人</th>
          <th>签字</th>
          <th>版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td><input v-model="selectedIds" type="checkbox" :value="Number(row.id)" /></td>
          <td>{{ row.考察编号 }}</td>
          <td>{{ row.考察批号 }}</td>
          <td>{{ row.考察条件 }}</td>
          <td>{{ row.考察时间点 }}</td>
          <td>{{ row.检验项目 }}</td>
          <td>{{ row.考察结果 }}</td>
          <td>{{ row.考察人 }}</td>
          <td>{{ row.签字人 ? `${row.签字人} ${row.签字时间}` : '未签字' }}</td>
          <td>第{{ row.版本 ?? 1 }}版</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="run('提交考察', row)">提交考察</button>
            <button class="link" type="button" @click="run('考察人签字', row)">考察人签字</button>
            <button class="link" type="button" @click="run('确认完成', row)">确认完成</button>
            <button class="link" type="button" @click="run('终止考察', row)">终止考察</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="12" class="empty-state">
            没有命中的考察记录。<template v-if="diagnosis.length">卡在哪一项见上方说明。</template>
            <template v-else>可调整条件，或先登记考察记录。</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条稳定性考察记录 · 第 {{ page }} / {{ pages }} 页</span>
      <span class="pager">
        <button class="btn ghost" type="button" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
        <button
          v-for="p in pages"
          :key="p"
          class="btn ghost"
          :class="{ current: p === page }"
          type="button"
          :disabled="p === page"
          @click="gotoPage(p)"
        >
          {{ p }}
        </button>
        <button class="btn ghost" type="button" :disabled="page >= pages" @click="gotoPage(page + 1)">下一页</button>
        <select v-model.number="size" @change="applySearch">
          <option :value="5">每页 5 条</option>
          <option :value="10">每页 10 条</option>
          <option :value="20">每页 20 条</option>
        </select>
      </span>
    </footer>

    <section class="panel">
      <h3>考察排期计划（按批号，只留最新一版）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>考察批号</th>
            <th>考察条件</th>
            <th>计划时间点</th>
            <th>考察人</th>
            <th>版本</th>
            <th>排期日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plan in plans" :key="String(plan.id)">
            <td>{{ plan.考察批号 }}</td>
            <td>{{ plan.考察条件 }}</td>
            <td>{{ plan.计划时间点 }}</td>
            <td>{{ plan.考察人 }}</td>
            <td>第{{ plan.版本 }}版</td>
            <td>{{ plan.排期日期 }}</td>
          </tr>
          <tr v-if="!plans.length">
            <td colspan="6" class="empty-state">还没有排期，先在「考察排期」里按批号登记计划</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  listPlans,
  registerStability,
  resetStability,
  schedulePlan,
  searchStability,
  signStability,
  stabilityStats,
  transitionStability,
} from '@/api/stability-service'
import { STABILITY_TIME_POINTS } from '@/data/stability'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const MODULE_KEY = 'stability'
const store = useSessionStore()
// 搜索条件和登记/排期表单都从这一个常量取考察时间点，两处拿到的为同一套。
const timePoints: readonly string[] = STABILITY_TIME_POINTS

const rows = ref<EntryRow[]>([])
const plans = ref<EntryRow[]>([])
const stats = ref<{ label: string; value: number }[]>([])
const total = ref(0)
const page = ref(1)
const pages = ref(1)
const size = ref(5)
const diagnosis = ref<string[]>([])
const message = ref('')
const errorMessage = ref('')
const activeForm = ref<'' | 'register' | 'plan'>('')
const selectedIds = ref<number[]>([])

const query = ref({ 考察编号: '', 批号起: '', 批号止: '', 时间点: [] as string[] })
const registerForm = ref({
  考察编号: '',
  考察批号: '',
  考察时间点: '',
  考察条件: '',
  检验项目: '',
  考察结果: '',
  考察人: '',
})
const planForm = ref({ 考察批号: '', 考察条件: '', 考察人: '', 时间点: [] as string[] })

const allChecked = computed(
  () =>
    rows.value.length > 0 &&
    rows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function toggleAll() {
  const pageIds = rows.value.map((row) => Number(row.id))
  selectedIds.value = allChecked.value
    ? selectedIds.value.filter((id) => !pageIds.includes(id))
    : [...new Set([...selectedIds.value, ...pageIds])]
}

function toggleForm(form: 'register' | 'plan') {
  activeForm.value = activeForm.value === form ? '' : form
}

function onPlanBatchChange() {
  const plan = plans.value.find((item) => String(item.考察批号) === registerForm.value.考察批号)
  if (plan) {
    registerForm.value.考察条件 = String(plan.考察条件 ?? '')
    registerForm.value.考察人 = String(plan.考察人 ?? '')
  }
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    message.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function submitRegister() {
  clearFeedback()
  const result = registerStability(registerForm.value)
  showResult(result)
  if (result.ok) {
    registerForm.value = { 考察编号: '', 考察批号: '', 考察时间点: '', 考察条件: '', 检验项目: '', 考察结果: '', 考察人: '' }
    reload()
  }
}

function submitPlan() {
  clearFeedback()
  const result = schedulePlan(planForm.value)
  showResult(result)
  if (result.ok) {
    planForm.value = { 考察批号: '', 考察条件: '', 考察人: '', 时间点: [] }
    reload()
  }
}

function run(action: string, row: EntryRow) {
  clearFeedback()
  const result =
    action === '考察人签字'
      ? signStability(Number(row.id), store.operator)
      : transitionStability(Number(row.id), action)
  showResult(result)
  if (result.ok) {
    reload()
  }
}

function batchSign() {
  clearFeedback()
  const ids = [...selectedIds.value]
  let signed = 0
  const failures: string[] = []
  for (const id of ids) {
    const result = signStability(id, store.operator)
    if (result.ok) {
      signed += 1
    } else {
      failures.push(result.message)
    }
  }
  message.value = `批量签字完成：成功 ${signed} 条` + (failures.length ? `，拦下 ${failures.length} 条` : '')
  errorMessage.value = failures.slice(0, 3).join('；')
  selectedIds.value = []
  reload()
}

function applySearch() {
  page.value = 1
  reload()
}

function gotoPage(target: number) {
  page.value = target
  reload()
}

function resetQuery() {
  query.value = { 考察编号: '', 批号起: '', 批号止: '', 时间点: [] }
  applySearch()
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function resetDemo() {
  clearFeedback()
  resetStability()
  selectedIds.value = []
  message.value = '演示数据已重置（供应商审计清单里的留痕保留）'
  reload()
}

function clearFeedback() {
  message.value = ''
  errorMessage.value = ''
}

function reload() {
  const result = searchStability({
    考察编号: query.value.考察编号,
    时间点: query.value.时间点,
    批号起: query.value.批号起,
    批号止: query.value.批号止,
    page: page.value,
    size: size.value,
  })
  rows.value = result.items
  total.value = result.total
  page.value = result.page
  pages.value = result.pages
  diagnosis.value = result.diagnosis
  plans.value = listPlans()
  stats.value = stabilityStats()
}

onMounted(reload)
</script>
