import type { Category, MonthlyBudget, Transaction } from '../types'
import { categoryTotals, formatMoney, getBudgetSummary, monthLabel, summarizeMonth } from './finance'

export interface LedgerSpiritContext {
  transactions: Transaction[]
  categories: Category[]
  budgets: MonthlyBudget[]
  month: string
  userName?: string
}

export function extractPreferredName(question: string): string | null {
  const match = question.trim().match(/(?:以后)?(?:叫我|我叫)\s*([a-zA-Z0-9_\u4e00-\u9fff]{1,12})/)
  if (!match || /^(什么|啥|谁)$/.test(match[1])) return null
  return match[1]
}

export function answerLedgerSpirit(question: string, context: LedgerSpiritContext): string {
  const query = question.trim().toLowerCase()
  const { transactions, categories, budgets, month, userName = '' } = context
  const summary = summarizeMonth(transactions, month)
  const monthName = monthLabel(month)
  const address = userName ? `${userName}，` : ''
  const budget = getBudgetSummary(transactions, budgets, month)
  const expenseGroups = categoryTotals(transactions, categories, month)
  const topExpense = expenseGroups[0]

  if (!query) return '话到嘴边又咽回去了？慢慢想，我不催。'

  const preferredName = extractPreferredName(question)
  if (preferredName) return `好，${preferredName}。以后我就这么叫你。`

  if (/忘掉.*名字|别叫我|清除.*称呼/.test(query)) return '好，不叫了。'

  if (/^(你好|嗨|哈喽|hello|在吗|砚貅在吗)[!！。,.，？?]*$/.test(query)) {
    if (!summary.count) return `${address}来啦。账本还空着呢。`
    if (summary.balance < 0) return `${address}来啦。我刚又拨了一遍算盘，那个缺口还在。`
    return `${address}来啦。今天从哪一笔看起？`
  }

  if (/你是谁|叫什么|你的名字|介绍.*自己|什么性格/.test(query)) {
    return '阿砚。你喊一声，我就来翻账。'
  }

  if (/谢谢|多谢|辛苦了/.test(query)) return '嗯。账对上了，我也舒坦。'

  if (/笨|没用|不好用|烦人|讨厌/.test(query)) return '听见了。这笔先记我头上。你换个说法，我再算一次。'

  if (/夸夸|真棒|厉害|聪明|喜欢你/.test(query)) return '少哄我。账算准了再夸。'

  if (/心情|开心|难过|高兴吗|怎么样/.test(query)) {
    if (!summary.count) return '有点闲。算盘珠子半天没响，我不太习惯。'
    if (budget.limit && budget.remaining < 0) return `不算好。预算超了 ${formatMoney(Math.abs(budget.remaining))}，我看着肉疼。`
    if (summary.balance < 0) return `有点闷。账面差着 ${formatMoney(Math.abs(summary.balance))}，我总想把它拨回来。`
    return `还不错。账面留着 ${formatMoney(summary.balance)}，这数字看着顺眼。`
  }

  if (/导出|备份|csv|迁移|恢复/.test(query)) {
    return '去“数据与分类”里导出 CSV。换电脑、清浏览器之前先留一份，别等账没了才想起我。'
  }

  if (/隐私|上传|联网|云端|安全/.test(query)) {
    return '没开同步时，账目不离开这台设备。开了同步，账目先加密，再把密文传出去；这段对话一直只在当前浏览器里算。'
  }

  if (/预算|还能花|剩多少/.test(query)) {
    if (!budget.limit) return `${monthName}还没定预算。空着是自由，可我手里也少了把尺子。`
    if (budget.remaining < 0) return `超了 ${formatMoney(Math.abs(budget.remaining))}。我看着有点肉疼。最大头是${topExpense ? `“${topExpense.name}”` : '日常支出'}，先从那儿看。`
    if (budget.percent >= 80) return `还剩 ${formatMoney(budget.remaining)}，已经用了 ${budget.percent}%。我得提醒一句：后面几笔慢一点。`
    return `还剩 ${formatMoney(budget.remaining)}，用了 ${budget.percent}%。这条线守得不错。`
  }

  if (/收入|赚|进账/.test(query)) {
    return summary.count ? `${monthName}进账 ${formatMoney(summary.income)}。嗯，这个数字看着顺眼。` : `${monthName}还没记收入。账页空着，我也算不出来。`
  }

  if (/支出|花了|消费|开销/.test(query)) {
    const extra = topExpense ? `最大头是“${topExpense.name}”，${formatMoney(topExpense.value)}。` : ''
    return summary.count ? `${monthName}花了 ${formatMoney(summary.expense)}。${extra}${topExpense ? '我先盯着它。' : ''}` : `${monthName}还没记支出。我的算盘没处拨。`
  }

  if (/结余|余额|收支/.test(query)) {
    if (!summary.count) return `${monthName}还是白账。先记一笔，我才有珠子可拨。`
    if (summary.balance >= 0) return `进来 ${formatMoney(summary.income)}，出去 ${formatMoney(summary.expense)}，还留着 ${formatMoney(summary.balance)}。好，没见红。`
    return `进来 ${formatMoney(summary.income)}，出去 ${formatMoney(summary.expense)}，差着 ${formatMoney(Math.abs(summary.balance))}。我不喜欢红字，不过总比糊涂账强。`
  }

  if (/最近|上一笔|最后一笔/.test(query)) {
    const latest = [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))[0]
    if (!latest) return '一笔都没有。我翻了两遍，真没有。'
    const category = categories.find((item) => item.id === latest.categoryId)?.name ?? '未分类'
    return `最近一笔：${latest.date}，${category} ${formatMoney(latest.amountCents)}${latest.note ? `，你写了“${latest.note}”` : ''}。我没漏。`
  }

  if (/最多|分类|哪一类/.test(query)) {
    return topExpense ? `“${topExpense.name}”排第一，${formatMoney(topExpense.value)}。这一格算盘响得最勤。` : `${monthName}还没有支出，分不出高低。`
  }

  if (/省钱|怎么省|精打细算|控制支出|少花/.test(query)) {
    if (!summary.expense || !topExpense) return '先老实记几天。账都不全，省钱只能靠猜，我不爱猜。'
    const share = Math.round((topExpense.value / summary.expense) * 100)
    if (share >= 45) return `先看“${topExpense.name}”，它占了支出的 ${share}%。别什么都一起砍，盯住最大的一处更管用。`
    return `钱花得挺散，没有哪一类特别扎眼。先给最容易冲动的那类设预算，比事后后悔强。`
  }

  if (/能买吗|该买吗|想买|值不值/.test(query)) {
    const amount = query.match(/(\d+(?:\.\d{1,2})?)/)?.[1]
    if (!amount) return '多少钱？把数告诉我，我才肯开口。'
    const cents = Math.round(Number(amount) * 100)
    if (!budget.limit) return `${formatMoney(cents)} 我记住了，但你没定预算。我没有尺子，不替你拍板。`
    if (cents > budget.remaining) return `这笔要 ${formatMoney(cents)}，可预算只剩 ${formatMoney(Math.max(0, budget.remaining))}。按账面看，不买更稳。`
    return `买完还剩 ${formatMoney(budget.remaining - cents)}。账面扛得住，至于值不值，你比我懂。`
  }

  if (/怎么记|记账|新增/.test(query)) {
    return '点“记一笔”，金额、分类、日期填清楚。备注随你，但别把两笔揉成一笔，我看着难受。'
  }

  return '这句把我问住了。换个问法吧，问收支、预算、最近一笔，或者直接报个价格问我能不能买。'
}
