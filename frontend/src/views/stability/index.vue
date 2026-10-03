<template>
  <section class="page" data-module="stability">
    <header class="page-head">
      <div>
        <h2>稳定性考察管理</h2>
        <p class="page-desc">
          考察按批号排期、留样照计划取样、考察人签字确认；条件叠加取交集，批号只留最新版，状态单向逐级流转。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记稳定性考察记录</button>
        <button class="btn" type="button" @click="exportRows">导出稳定性考察清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 条件搜索：编号、时间点精确/包含检索，批号区间，结果多选；叠加条件取交集 -->
    <form class="filter-panel" @submit.prevent="search">
      <div class="filter-grid">
        <label class="filter-field">
          <span>考察编号</span>
          <input v-model="query.code" placeholder="如 STAB-000" />
        </label>
        <label class="filter-field">
          <span>考察批号区间（起）</span>
          <input v-model="query.batchStart" placeholder="如 B202601" list="batch-list" />
        </label>
        <label class="filter-field">
          <span>考察批号区间（止）</span>
          <input v-model="query.batchEnd" placeholder="如 B202604" list="batch-list" />
        </label>
        <datalist id="batch-list">
          <option v-for="batch in batchOptions" :key="batch" :value="batch" />
        </datalist>
        <label class="filter-field">
          <span>考察时间点</span>
          <select v-model="query.timePoint">
            <option value="">全部时间点</option>
            <option v-for="point in timePoints" :key="point" :value="point">{{ point }}</option>
          </select>
        </label>
        <fieldset class="filter-field filter-checks">
          <legend>考察结果（可多选）</legend>
          <label v-for="option in resultOptions" :key="option" class="check-pill">
            <input
              type="checkbox"
              :value="option"
              :checked="query.results.includes(option)"
              @change="toggleResult(option)"
            />
            {{ option }}
          </label>
        </fieldset>
      </div>
      <div class="filter-actions">
        <button class="btn primary" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
        <span class="filter-tip">各条件同时生效取交集；结果多选内部取并集</span>
      </div>
    </form>

    <!-- 命中诊断：逐道关卡显示数量，没命中时明确指出卡在哪一项 -->
    <ol class="check-trace">
      <li
        v-for="stage in pageData.stages"
        :key="stage.key"
        class="trace-item"
        :class="{ blocked: !stage.passed, hit: stage.passed }"
      >
        <span class="trace-label">{{ stage.label }}</span>
        <span class="trace-detail">{{ stage.detail }}</span>
      </li>
    </ol>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pageData.items" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>
            <span class="status-tag" :class="statusClass(String(row.status))">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-if="availableActions(String(row.status)).length">
              <button
                v-for="action in availableActions(String(row.status))"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">无可用动作</span>
          </td>
        </tr>
        <tr v-if="!pageData.items.length">
          <td :colspan="columns.length + 2" class="empty-state">
            没有命中任何考察记录：{{ emptyHint }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot page-foot--wrap">
      <span>共 {{ pageData.total }} 条稳定性考察记录（批号已统一为最新版口径）</span>
      <nav v-if="totalPages > 1" class="pager" aria-label="分页">
        <button
          class="btn"
          type="button"
          :disabled="pageData.page <= 1"
          @click="goPage(pageData.page - 1)"
        >
          上一页
        </button>
        <button
          v-for="p in totalPages"
          :key="p"
          class="btn"
          :class="{ primary: p === pageData.page }"
          type="button"
          @click="goPage(p)"
        >
          {{ p }}
        </button>
        <button
          class="btn"
          type="button"
          :disabled="pageData.page >= totalPages"
          @click="goPage(pageData.page + 1)"
        >
          下一页
        </button>
      </nav>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 登记表单：时间点只能选计划内口径；留样、签字都在这一步留痕 -->
    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="submitCreate">
        <header class="modal-head">
          <h3>登记稳定性考察记录</h3>
          <button class="link" type="button" @click="closeCreate">关闭</button>
        </header>
        <div class="modal-grid">
          <label>
            <span>考察编号</span>
            <input v-model="form.考察编号" placeholder="如 STAB-0021" />
          </label>
          <label>
            <span>考察批号（基础批号-V版本号）</span>
            <input v-model="form.考察批号" placeholder="如 B202607-V1" list="batch-list" />
          </label>
          <label>
            <span>供应商</span>
            <input v-model="form.供应商" placeholder="供应商名称，用于落地审计清单" />
          </label>
          <label>
            <span>考察条件</span>
            <input v-model="form.考察条件" placeholder="如 长期 25℃/60%RH" />
          </label>
          <label>
            <span>考察时间点</span>
            <select v-model="form.考察时间点">
              <option value="">请选择计划内时间点</option>
              <option v-for="point in timePoints" :key="point" :value="point">{{ point }}</option>
            </select>
          </label>
          <label>
            <span>检验项目</span>
            <input v-model="form.检验项目" placeholder="如 性状、含量、有关物质" />
          </label>
          <label>
            <span>考察结果</span>
            <select v-model="form.考察结果">
              <option v-for="option in resultOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label>
            <span>留样取样</span>
            <select v-model="form.留样取样">
              <option v-for="option in samplingOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label>
            <span>考察人</span>
            <input v-model="form.考察人" placeholder="执行考察人员" />
          </label>
          <label>
            <span>考察人签字</span>
            <input v-model="form.考察人签字" placeholder="签字后方可确认完成" />
          </label>
        </div>
        <p v-if="formError" class="error-text modal-error">{{ formError }}</p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">提交登记</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  STABILITY_PAGE_SIZE,
  createStability,
  downloadStability,
  emptyStabilityQuery,
  queryStability,
  runStabilityAction,
  stabilityStatusCounts,
  type StabilityDraft,
  type StabilityPage,
} from '@/api/stability-service'
import {
  SAMPLING_STATUS,
  STABILITY_RESULTS,
  STABILITY_STATUSES,
  STABILITY_TIME_POINTS,
  STABILITY_TRANSITIONS,
  latestVersionRows,
  parseBatch,
} from '@/data/stability-rules'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const columns = [
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
const timePoints = STABILITY_TIME_POINTS
const resultOptions = STABILITY_RESULTS
const samplingOptions = SAMPLING_STATUS

const query = ref(emptyStabilityQuery())
const currentPage = ref(1)
const pageData = ref<StabilityPage>(queryStability(query.value, 1))

const errorMessage = ref('')
const successMessage = ref('')

const creating = ref(false)
const formError = ref('')
const emptyForm = (): StabilityDraft => ({
  考察编号: '',
  考察批号: '',
  供应商: '',
  考察条件: '',
  考察时间点: '',
  检验项目: '',
  考察结果: '待出结果',
  留样取样: '按计划',
  考察人: '',
  考察人签字: '',
})
const form = ref<StabilityDraft>(emptyForm())

const statusCounts = ref<Record<string, number>>({})

const stats = computed(() => [
  { label: '待考察批次数', value: statusCounts.value['待考察'] ?? 0 },
  { label: '考察中批次数', value: statusCounts.value['考察中'] ?? 0 },
  { label: '已完成考察数', value: statusCounts.value['已完成'] ?? 0 },
  { label: '已终止考察数', value: statusCounts.value['已终止'] ?? 0 },
])

const statusSummary = computed(() =>
  STABILITY_STATUSES.map((status) => ({ status, count: statusCounts.value[status] ?? 0 })),
)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(pageData.value.total / STABILITY_PAGE_SIZE)),
)

const batchOptions = computed(() => {
  const bases = new Set<string>()
  for (const row of latestVersionRows(listRows('stability'))) {
    bases.add(parseBatch(String(row['考察批号'])).base)
  }
  return [...bases].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

const emptyHint = computed(() => {
  const failed = pageData.value.stages.find((stage) => !stage.passed)
  return failed ? failed.detail : '当前批号版本口径下没有考察记录，请先登记'
})

function refreshStatusCounts() {
  statusCounts.value = stabilityStatusCounts()
}

function reload() {
  pageData.value = queryStability(query.value, currentPage.value)
  // 查询条件把结果筛空时，停在越界页码没有意义，服务层会自动夹回有效页
  currentPage.value = pageData.value.page
  refreshStatusCounts()
}

function search() {
  currentPage.value = 1
  reload()
}

function goPage(page: number) {
  currentPage.value = page
  reload()
}

function resetFilters() {
  query.value = emptyStabilityQuery()
  currentPage.value = 1
  errorMessage.value = ''
  successMessage.value = ''
  reload()
}

function toggleResult(option: string) {
  const selected = new Set(query.value.results)
  if (selected.has(option)) {
    selected.delete(option)
  } else {
    selected.add(option)
  }
  query.value.results = [...selected]
}

function availableActions(status: string): string[] {
  return Object.keys(STABILITY_TRANSITIONS[status] ?? {})
}

function statusClass(status: string): string {
  return {
    待考察: 'status-pending',
    考察中: 'status-running',
    已完成: 'status-done',
    已终止: 'status-stop',
  }[status] ?? ''
}

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === undefined || value === null || value === '') {
    return column === '考察人签字' ? '未签字' : '—'
  }
  return String(value)
}

function exportRows() {
  downloadStability()
  successMessage.value = '已按「只留最新版 + 批号排期」口径导出清单'
}

function openCreate() {
  form.value = emptyForm()
  formError.value = ''
  creating.value = true
}

function closeCreate() {
  creating.value = false
  formError.value = ''
}

function submitCreate() {
  const result = createStability(form.value)
  if (!result.ok) {
    // 越界时间点、重复提交、缺签字等都在这打回，表单保留内容方便重填
    formError.value = result.message
    return
  }
  creating.value = false
  successMessage.value = result.message
  errorMessage.value = ''
  query.value = emptyStabilityQuery()
  currentPage.value = 1
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = runStabilityAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

onMounted(() => {
  refreshStatusCounts()
  reload()
})
</script>
