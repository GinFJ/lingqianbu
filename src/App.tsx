import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, ChevronLeft, ChevronRight,
  CircleHelp, Copy, Download, FileUp, LayoutDashboard, Link2, Menu, Pencil, PiggyBank, Plus,
  QrCode as QrCodeIcon, ReceiptText, RefreshCw, Search, Send, Settings2, ShieldCheck, Smartphone,
  Trash2, Wifi, WifiOff, X,
} from 'lucide-react'
import { useFinance } from './context/FinanceContext'
import type { CsvParseResult, Transaction, TransactionDraft, TransactionType } from './types'
import {
  currentMonth, formatMoney, getBudgetSummary, monthLabel, parseAmountToCents,
  recentMonths, summarizeMonth, todayIso,
} from './lib/finance'
import { downloadCsv, parseTransactionsCsv, transactionsToCsv } from './lib/csv'
import { answerLedgerSpirit, extractPreferredName } from './lib/spirit'
import { CategoryIcon } from './components/CategoryIcon'
import ayanWatercolor from './assets/ayan-watercolor-v1.webp'

const ReportsPage = lazy(() => import('./components/ReportsPage'))

type Page = 'dashboard' | 'transactions' | 'budgets' | 'reports'

const NAV_ITEMS: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard },
  { id: 'transactions', label: '流水', icon: ReceiptText },
  { id: 'budgets', label: '预算', icon: PiggyBank },
  { id: 'reports', label: '报表', icon: BarChart3 },
]

function App() {
  const finance = useFinance()
  const [page, setPage] = useState<Page>('dashboard')
  const [month, setMonth] = useState(currentMonth())
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [transactionOpen, setTransactionOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [spiritOpen, setSpiritOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (finance.sync.pendingPairingCode) setDataOpen(true)
  }, [finance.sync.pendingPairingCode])

  const announce = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  if (finance.loading) return <LoadingScreen />

  const openNew = () => {
    setEditing(null)
    setTransactionOpen(true)
  }

  const openEdit = (transaction: Transaction) => {
    setEditing(transaction)
    setTransactionOpen(true)
  }

  const changeMonth = (offset: number) => {
    const [year, value] = month.split('-').map(Number)
    const date = new Date(year, value - 1 + offset, 1)
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar-nav" aria-label="主导航">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="nav-item data-button" onClick={() => setDataOpen(true)}><Settings2 size={19} /><span>数据与分类</span></button>
      </aside>

      <main className={`main-content theme-page-${page}`}>
        <PageInkBackdrop />
        <header className="topbar">
          <div className="mobile-brand"><Brand compact /></div>
          <MonthPicker month={month} onChange={changeMonth} />
          <button className="primary-button top-add" onClick={openNew}><Plus size={18} />记一笔</button>
          <button className="icon-button mobile-data" onClick={() => setDataOpen(true)} aria-label="数据与分类"><Menu size={22} /></button>
        </header>

        <div className="page-wrap" key={`${page}-${month}`}>
          {page === 'dashboard' && <Dashboard month={month} onAdd={openNew} onImport={() => setDataOpen(true)} onEdit={openEdit} />}
          {page === 'transactions' && <TransactionsPage month={month} onEdit={openEdit} onAdd={openNew} announce={announce} />}
          {page === 'budgets' && <BudgetsPage month={month} announce={announce} />}
          {page === 'reports' && <Suspense fallback={<PageLoading text="正在展开报表…" />}><ReportsPage month={month} /></Suspense>}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="floating-add" onClick={openNew} aria-label="记一笔"><Plus size={26} /></button>
      <AyanCompanion month={month} page={page} chatOpen={spiritOpen} onTalk={() => setSpiritOpen(true)} />

      {transactionOpen && (
        <TransactionModal
          transaction={editing}
          month={month}
          onClose={() => setTransactionOpen(false)}
          onSaved={(message) => { setTransactionOpen(false); announce(message) }}
        />
      )}
      {dataOpen && <DataModal month={month} onClose={() => setDataOpen(false)} announce={announce} />}
      <SpiritChat open={spiritOpen} month={month} onClose={() => setSpiritOpen(false)} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'brand compact' : 'brand'}>
      <div className="brand-seal">零</div>
      <div><strong>零钱簿</strong>{!compact && <span>日子有账，心里有数</span>}</div>
    </div>
  )
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="brand-seal">零</div><p>正在翻开账簿…</p></div>
}

function PageLoading({ text }: { text: string }) {
  return <div className="page-loading" role="status"><RefreshCw className="spin" size={20} /><span>{text}</span></div>
}

type AyanMood = 'idle' | 'pleased' | 'watchful'

function AyanCompanion({ month, page, chatOpen, onTalk }: { month: string; page: Page; chatOpen: boolean; onTalk: () => void }) {
  const { transactions, budgets } = useFinance()
  const summary = summarizeMonth(transactions, month)
  const budget = getBudgetSummary(transactions, budgets, month)
  const mood: AyanMood = budget.limit && budget.remaining < 0 ? 'watchful' : summary.count && summary.balance >= 0 ? 'pleased' : 'idle'
  const [line, setLine] = useState('')
  const lineTimer = useRef<number | null>(null)

  const showLine = (text: string, duration = 3000) => {
    if (lineTimer.current) window.clearTimeout(lineTimer.current)
    setLine(text)
    lineTimer.current = window.setTimeout(() => { setLine(''); lineTimer.current = null }, duration)
  }

  useEffect(() => {
    const pageLine: Record<Page, string> = {
      dashboard: !summary.count ? '账页还空着。' : summary.balance >= 0 ? `这个月还留着 ${formatMoney(summary.balance)}。` : `账面差着 ${formatMoney(Math.abs(summary.balance))}。`,
      transactions: '一笔一笔来，别揉在一起。',
      budgets: !budget.limit ? '预算还空着，我手里没尺子。' : budget.remaining >= 0 ? `预算还剩 ${formatMoney(budget.remaining)}。` : `预算超了 ${formatMoney(Math.abs(budget.remaining))}。`,
      reports: '图我看过了，数字没躲。',
    }
    showLine(pageLine[page], 3200)
    return () => { if (lineTimer.current) window.clearTimeout(lineTimer.current) }
  }, [page, month, summary.count, summary.balance, budget.limit, budget.remaining])

  return (
    <div className={`ayan-companion mood-${mood}${chatOpen ? ' chat-open' : ''}`}>
      {line && <div className="ayan-speech" role="status">{line}</div>}
      <button
        type="button"
        className="ayan-stage"
        aria-label="和阿砚说话"
        title="阿砚"
        onMouseEnter={() => showLine('找我算账？', 1800)}
        onFocus={() => showLine('找我算账？', 1800)}
        onClick={() => { showLine('我在。', 800); onTalk() }}
      >
        <AyanSprite mood={mood} />
      </button>
    </div>
  )
}

function AyanSprite({ mood }: { mood: AyanMood }) {
  return (
    <img className={`ayan-painted mood-${mood}`} src={ayanWatercolor} alt="" aria-hidden="true" />
  )
}

function AyanFaceMark() {
  return (
    <span className="ayan-face-mark" aria-hidden="true"><img src={ayanWatercolor} alt="" /></span>
  )
}

type SpiritMessage = { role: 'spirit' | 'user'; text: string }

function SpiritChat({ open, month, onClose }: { open: boolean; month: string; onClose: () => void }) {
  const { transactions, categories, budgets } = useFinance()
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const [preferredName, setPreferredName] = useState(() => localStorage.getItem('lingqianbu-spirit-name') ?? '')
  const replyTimer = useRef<number | null>(null)
  const messagesEnd = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  if (open && !returnFocusRef.current && document.activeElement instanceof HTMLElement) {
    returnFocusRef.current = document.activeElement
  }
  const [messages, setMessages] = useState<SpiritMessage[]>([
    { role: 'spirit', text: `${preferredName ? `${preferredName}，` : ''}来啦。今天从哪一笔看起？` },
  ])

  useEffect(() => {
    if (!open) return
    const previousFocus = returnFocusRef.current
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus()
        returnFocusRef.current = null
      })
    }
  }, [open])

  useEffect(() => () => {
    if (replyTimer.current) window.clearTimeout(replyTimer.current)
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages, thinking])

  const ask = (question: string) => {
    const value = question.trim()
    if (!value || thinking) return
    const nextName = extractPreferredName(value)
    const forgetName = /忘掉.*名字|别叫我|清除.*称呼/.test(value)
    let nameForReply = preferredName
    if (nextName) {
      nameForReply = nextName
      setPreferredName(nextName)
      localStorage.setItem('lingqianbu-spirit-name', nextName)
    } else if (forgetName) {
      nameForReply = ''
      setPreferredName('')
      localStorage.removeItem('lingqianbu-spirit-name')
    }
    const answer = answerLedgerSpirit(value, { transactions, categories, budgets, month, userName: nameForReply })
    setMessages((current) => [...current, { role: 'user', text: value }])
    setDraft('')
    setThinking(true)
    replyTimer.current = window.setTimeout(() => {
      setMessages((current) => [...current, { role: 'spirit', text: answer }])
      setThinking(false)
      replyTimer.current = null
    }, Math.min(720, 280 + value.length * 14))
  }

  if (!open) return null

  const suggestions = ['本月花了多少？', '预算还剩多少？', '你今天心情怎么样？', '最近一笔是什么？']

  return (
    <div className="spirit-chat-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="spirit-chat" role="dialog" aria-modal="true" aria-labelledby="spirit-chat-title" onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, onClose)}>
        <header>
          <div className="spirit-chat-avatar"><AyanFaceMark /></div>
          <div><span>零钱簿 · 账灵</span><h2 id="spirit-chat-title">阿砚</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭对话"><X size={19} /></button>
        </header>
        <div className="spirit-messages" aria-live="polite">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`spirit-message ${message.role}`}>
              {message.role === 'spirit' && <AyanFaceMark />}
              <p>{message.text}</p>
            </div>
          ))}
          {thinking && <div className="spirit-message spirit thinking"><AyanFaceMark /><p aria-label="阿砚正在想"><span /><span /><span /></p></div>}
          <div ref={messagesEnd} />
        </div>
        <div className="spirit-suggestions">
          {suggestions.map((item) => <button key={item} onClick={() => ask(item)} disabled={thinking}>{item}</button>)}
        </div>
        <form className="spirit-input" onSubmit={(event) => { event.preventDefault(); ask(draft) }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="问阿砚……" aria-label="向阿砚提问" autoFocus data-dialog-autofocus />
          <button type="submit" aria-label="发送" disabled={!draft.trim() || thinking}><Send size={18} /></button>
        </form>
      </section>
    </div>
  )
}

function MonthPicker({ month, onChange }: { month: string; onChange: (offset: number) => void }) {
  return (
    <div className="month-picker">
      <button onClick={() => onChange(-1)} aria-label="上个月"><ChevronLeft size={18} /></button>
      <div><span>查看月份</span><strong>{monthLabel(month)}</strong></div>
      <button onClick={() => onChange(1)} aria-label="下个月"><ChevronRight size={18} /></button>
    </div>
  )
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
}

function Dashboard({ month, onAdd, onImport, onEdit }: { month: string; onAdd: () => void; onImport: () => void; onEdit: (t: Transaction) => void }) {
  const { transactions, categories, budgets, settings, markVisited } = useFinance()
  const summary = summarizeMonth(transactions, month)
  const budget = getBudgetSummary(transactions, budgets, month)
  const months = recentMonths(month, 6)
  const chartData = months.map((item) => ({
    month: `${Number(item.slice(5))}月`,
    incomeCents: summarizeMonth(transactions, item).income,
    expenseCents: summarizeMonth(transactions, item).expense,
  }))
  const recent = transactions.filter((item) => item.date.startsWith(month)).slice(0, 5)
  const firstVisit = !settings?.hasVisited && transactions.length === 0

  if (firstVisit) {
    return (
      <section className="welcome-ledger">
        <div className="welcome-copy">
          <span className="eyebrow">《增广贤文》</span>
          <h1 className="classic-quote">常将有日思无日，<br />莫待无时思有时。</h1>
          <div className="welcome-actions">
            <button className="primary-button" onClick={() => { markVisited(); onAdd() }}><Plus size={18} />记下第一笔</button>
            <button className="paper-button" onClick={() => { markVisited(); onImport() }}><FileUp size={18} />从 CSV 导入</button>
          </div>
        </div>
        <div className="ledger-illustration" aria-hidden="true">
          <div className="ledger-page back" />
          <div className="ledger-page front">
            <div className="ledger-date">八月 · 日常账</div>
            <div className="ink-line short" /><div className="ink-line" /><div className="ink-line medium" />
            <div className="red-stamp">有<br />数</div>
            <div className="leaf-mark">〽</div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <PageHeading eyebrow="本月账面" title="今天，也在认真生活。" description={`${monthLabel(month)}共有 ${summary.count} 笔记录，下面是你的收支近况。`} />
      <section className="metric-grid">
        <MetricCard label="本月结余" value={formatMoney(summary.balance)} className="featured" note={summary.balance >= 0 ? '收支仍有余地' : '本月支出超过收入'} icon={<PiggyBank />} />
        <MetricCard label="本月收入" value={formatMoney(summary.income)} note="所有收入合计" icon={<ArrowDownLeft />} />
        <MetricCard label="本月支出" value={formatMoney(summary.expense)} note="所有支出合计" icon={<ArrowUpRight />} />
        <MetricCard label="预算使用" value={budget.limit ? `${budget.percent}%` : '未设置'} note={budget.limit ? `还可用 ${formatMoney(Math.max(0, budget.remaining))}` : '去预算页定个范围'} icon={<CalendarDays />} />
      </section>
      <section className="dashboard-grid">
        <Card className="trend-card">
          <CardHeader title="近六个月收支" subtitle="一眼看清钱的来处与去处" />
          {transactions.length ? (
            <MiniTrendChart data={chartData} />
          ) : <EmptyMini text="记下几笔后，这里会长出你的收支曲线。" />}
        </Card>
        <Card className="recent-card">
          <CardHeader title="最近流水" subtitle="本月新近记下的几笔" />
          {recent.length ? <TransactionList transactions={recent} categories={categories} onEdit={onEdit} /> : <EmptyMini text="这个月还没有流水。" />}
        </Card>
      </section>
    </>
  )
}

function MiniTrendChart({ data }: { data: Array<{ month: string; incomeCents: number; expenseCents: number }> }) {
  const width = 620
  const height = 220
  const left = 32
  const right = 18
  const top = 24
  const bottom = 34
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const maxValue = Math.max(1, ...data.flatMap((item) => [item.incomeCents, item.expenseCents]))
  const point = (value: number, index: number) => {
    const x = left + (data.length === 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth)
    const y = top + plotHeight - value / maxValue * plotHeight
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  const incomePoints = data.map((item, index) => point(item.incomeCents, index)).join(' ')
  const expensePoints = data.map((item, index) => point(item.expenseCents, index)).join(' ')

  return (
    <figure className="trend-figure">
      <div className="chart-key" aria-hidden="true"><span className="income">收入</span><span className="expense">支出</span></div>
      <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {[0, 1, 2, 3].map((index) => {
          const y = top + index / 3 * plotHeight
          return <line key={index} x1={left} x2={width - right} y1={y} y2={y} className="trend-grid-line" />
        })}
        <polyline points={incomePoints} className="trend-line income" />
        <polyline points={expensePoints} className="trend-line expense" />
        {data.map((item, index) => {
          const x = left + (data.length === 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth)
          return <text key={item.month} x={x} y={height - 10} textAnchor="middle" className="trend-month">{item.month}</text>
        })}
      </svg>
      <figcaption className="sr-only">近六个月收入与支出趋势。详细数值如下。</figcaption>
      <table className="sr-only">
        <caption>近六个月收支明细</caption>
        <thead><tr><th scope="col">月份</th><th scope="col">收入</th><th scope="col">支出</th></tr></thead>
        <tbody>{data.map((item) => <tr key={item.month}><th scope="row">{item.month}</th><td>{formatMoney(item.incomeCents)}</td><td>{formatMoney(item.expenseCents)}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

function PageInkBackdrop() {
  return (
    <svg className="page-ink-backdrop" viewBox="0 0 1300 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="page-ink-soft"><feGaussianBlur stdDeviation="9" /></filter>
        <filter id="page-ink-edge"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="2" seed="12" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="10" /></filter>
      </defs>
      <circle className="page-ink-sun" cx="1060" cy="160" r="44" />
      <path className="page-ink-cloud" filter="url(#page-ink-soft)" d="M610 177c68-54 119-29 146 8 44-49 113-44 141 7 65-36 134 6 114 63H592c-37-31-17-61 18-78Z" />
      <g className="page-ink-bamboo" filter="url(#page-ink-edge)">
        <path d="M1194 70c-11 190-8 387-18 592M1230 9c-24 201-18 425-36 699M1167 160c-74-40-112-39-158-22M1184 242c-54-43-92-55-136-51M1203 112c42-42 64-57 92-70M1189 338c45-38 71-45 105-45" />
        <path d="M1093 132q-40-38-82 5q49 9 82-5Zm-43 60q-31-32-67 5q41 7 67-5Zm149-92q35-35 72-3q-42 10-72 3Zm-8 195q39-31 71 5q-43 6-71-5Z" />
      </g>
      <path className="page-ink-mountain back" filter="url(#page-ink-soft)" d="M330 768c109-101 180-122 282-33 84-120 183-171 287-59 71 77 124 75 202-30 54-72 120-53 229 21v233H250Z" />
      <path className="page-ink-mountain front" d="M147 835c127-63 232-60 351-2 112 55 192 38 299-21 127-69 253-26 373 31 49 23 95 31 160 18v39H100Z" />
      <path className="page-ink-ridge" filter="url(#page-ink-edge)" d="M197 815c104-42 194-73 304-13 115 63 191 42 300-31 112-75 225-35 337 24 74 39 120 38 182 21" />
      <g className="page-ink-birds"><path d="M860 318q12-13 25 0q12-13 25 0" /><path d="M929 286q9-10 19 0q9-10 19 0" /></g>
    </svg>
  )
}

function MetricCard({ label, value, note, icon, className = '' }: { label: string; value: string; note: string; icon: ReactNode; className?: string }) {
  return <article className={`metric-card ${className}`}><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></article>
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <article className={`paper-card ${className}`}>{children}</article>
}

function CardHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <header className="card-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</header>
}

function TransactionsPage({ month, onEdit, onAdd, announce }: { month: string; onEdit: (t: Transaction) => void; onAdd: () => void; announce: (m: string) => void }) {
  const { transactions, categories, deleteTransaction } = useFinance()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | TransactionType>('all')
  const [categoryId, setCategoryId] = useState('all')
  const rows = transactions.filter((item) => {
    const category = categories.find((entry) => entry.id === item.categoryId)
    return item.date.startsWith(month)
      && (type === 'all' || item.type === type)
      && (categoryId === 'all' || item.categoryId === categoryId)
      && (!query || `${item.note}${category?.name}`.toLowerCase().includes(query.toLowerCase()))
  })

  const remove = async (item: Transaction) => {
    if (!window.confirm(`确定删除 ${item.date} 的 ${formatMoney(item.amountCents)} 吗？此操作无法撤销。`)) return
    try {
      await deleteTransaction(item.id)
      announce('这笔流水已删除')
    } catch {
      announce('删除失败，流水仍保留在本机')
    }
  }

  return (
    <>
      <PageHeading eyebrow="逐笔明细" title="每一笔，都有来处。" description={`${monthLabel(month)}筛选到 ${rows.length} 笔流水。`} />
      <Card>
        <div className="filter-bar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索备注或分类" aria-label="搜索流水" /></label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="按类型筛选"><option value="all">全部类型</option><option value="expense">支出</option><option value="income">收入</option></select>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="按分类筛选"><option value="all">全部分类</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="primary-button" onClick={onAdd}><Plus size={18} />新增流水</button>
        </div>
        {rows.length ? (
          <div className="transaction-table">
            <div className="table-head"><span>日期 / 备注</span><span>分类</span><span>金额</span><span>操作</span></div>
            {rows.map((item) => {
              const category = categories.find((c) => c.id === item.categoryId)
              return (
                <div className="table-row" key={item.id}>
                  <div><strong>{item.note || (item.type === 'expense' ? '日常支出' : '一笔收入')}</strong><small>{item.date}</small></div>
                  <div className="category-chip" style={{ '--category': category?.color } as React.CSSProperties}><CategoryIcon name={category?.icon ?? 'Tag'} size={15} />{category?.name ?? '未分类'}</div>
                  <strong className={item.type}>{item.type === 'income' ? '+' : '-'}{formatMoney(item.amountCents)}</strong>
                  <div className="row-actions"><button onClick={() => onEdit(item)} aria-label={`编辑 ${item.note || category?.name || '流水'}`}><Pencil size={16} /></button><button onClick={() => remove(item)} aria-label={`删除 ${item.note || category?.name || '流水'}`}><Trash2 size={16} /></button></div>
                </div>
              )
            })}
          </div>
        ) : <EmptyState title="没有符合条件的流水" text="换个筛选条件，或者现在记下一笔。" action={<button className="paper-button" onClick={onAdd}><Plus size={17} />记一笔</button>} />}
      </Card>
    </>
  )
}

function BudgetsPage({ month, announce }: { month: string; announce: (m: string) => void }) {
  const { transactions, categories, budgets, setBudget } = useFinance()
  const expenseCategories = categories.filter((item) => item.type === 'expense')
  const summary = getBudgetSummary(transactions, budgets, month)
  const [values, setValues] = useState<Record<string, string>>({})

  const spentByCategory = useMemo(() => {
    const result = new Map<string, number>()
    transactions.filter((item) => item.type === 'expense' && item.date.startsWith(month)).forEach((item) => result.set(item.categoryId, (result.get(item.categoryId) ?? 0) + item.amountCents))
    return result
  }, [transactions, month])

  const save = async (categoryId: string, existing: number) => {
    const value = values[categoryId] ?? (existing ? String(existing / 100) : '')
    try {
      await setBudget(month, categoryId, value)
      announce(value ? '预算已保存' : '该分类预算已移除')
    } catch {
      announce('预算保存失败，请检查金额后重试')
    }
  }

  return (
    <>
      <PageHeading eyebrow="给消费留边界" title="预算不是束缚，是提前做的选择。" description={`为${monthLabel(month)}的每类支出定一个舒服的范围。`} />
      <section className="budget-overview">
        <div><span>总预算</span><strong>{formatMoney(summary.limit)}</strong></div><i />
        <div><span>已花费</span><strong>{formatMoney(summary.spent)}</strong></div><i />
        <div><span>{summary.remaining >= 0 ? '还可使用' : '已超出'}</span><strong className={summary.remaining < 0 ? 'danger' : ''}>{formatMoney(Math.abs(summary.remaining))}</strong></div>
        <div className="budget-ring" style={{ '--progress': `${Math.min(summary.percent, 100) * 3.6}deg` } as React.CSSProperties}><span>{summary.limit ? `${summary.percent}%` : '—'}</span></div>
      </section>
      <div className="budget-list">
        {expenseCategories.map((category) => {
          const budget = budgets.find((item) => item.month === month && item.categoryId === category.id)
          const spent = spentByCategory.get(category.id) ?? 0
          const percent = budget?.limitCents ? Math.round(spent / budget.limitCents * 100) : 0
          return (
            <Card key={category.id} className={percent > 100 ? 'budget-item over' : 'budget-item'}>
              <div className="budget-icon" style={{ background: `${category.color}18`, color: category.color }} aria-hidden="true"><CategoryIcon name={category.icon} size={21} /></div>
              <div className="budget-main">
                <div className="budget-title"><strong>{category.name}</strong><span>{formatMoney(spent)} / {budget ? formatMoney(budget.limitCents) : '未设置'}</span></div>
                <div className="progress-track" role="progressbar" aria-label={`${category.name}预算使用进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-valuetext={budget ? (percent > 100 ? `已超出预算 ${percent - 100}%` : `已使用 ${percent}%`) : '尚未设置预算'}><span style={{ width: `${Math.min(percent, 100)}%`, background: percent > 100 ? '#b94b3b' : category.color }} /></div>
                <small>{budget ? (percent > 100 ? `超出 ${formatMoney(spent - budget.limitCents)}` : `还剩 ${formatMoney(budget.limitCents - spent)}`) : '设置后可追踪本月进度'}</small>
              </div>
              <div className="budget-input"><span aria-hidden="true">¥</span><input inputMode="decimal" value={values[category.id] ?? (budget ? String(budget.limitCents / 100) : '')} onChange={(e) => setValues((old) => ({ ...old, [category.id]: e.target.value }))} placeholder="0" aria-label={`${category.name}预算`} /><button aria-label={`保存${category.name}预算`} onClick={() => save(category.id, budget?.limitCents ?? 0)}>保存</button></div>
            </Card>
          )
        })}
      </div>
    </>
  )
}

function TransactionList({ transactions, categories, onEdit }: { transactions: Transaction[]; categories: ReturnType<typeof useFinance>['categories']; onEdit: (t: Transaction) => void }) {
  return <div className="compact-list">{transactions.map((item) => { const category = categories.find((c) => c.id === item.categoryId); return <button key={item.id} onClick={() => onEdit(item)}><i style={{ background: `${category?.color}18`, color: category?.color }}><CategoryIcon name={category?.icon ?? 'Tag'} size={17} /></i><span><strong>{item.note || category?.name}</strong><small>{item.date} · {category?.name}</small></span><b className={item.type}>{item.type === 'income' ? '+' : '-'}{formatMoney(item.amountCents)}</b></button> })}</div>
}

function TransactionModal({ transaction, month, onClose, onSaved }: { transaction: Transaction | null; month: string; onClose: () => void; onSaved: (m: string) => void }) {
  const { categories, addTransaction, updateTransaction, addCategory } = useFinance()
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'expense')
  const allowed = categories.filter((item) => item.type === type)
  const [draft, setDraft] = useState<TransactionDraft>({
    type,
    amount: transaction ? String(transaction.amountCents / 100) : '',
    categoryId: transaction?.categoryId ?? categories.find((item) => item.type === type)?.id ?? '',
    date: transaction?.date ?? (month === currentMonth() ? todayIso() : `${month}-01`),
    note: transaction?.note ?? '',
  })
  const [error, setError] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState('')

  const changeType = (next: TransactionType) => {
    setType(next)
    setDraft((old) => ({ ...old, type: next, categoryId: categories.find((item) => item.type === next)?.id ?? '' }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!parseAmountToCents(draft.amount)) return setError('请输入大于 0、最多两位小数的金额')
    if (!draft.categoryId) return setError('请选择分类')
    try {
      if (transaction) await updateTransaction(transaction.id, draft)
      else await addTransaction(draft)
      onSaved(transaction ? '流水已更新' : '新流水已记下')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
  }

  const createCategory = async () => {
    try {
      const category = await addCategory(customName, type)
      setDraft((old) => ({ ...old, categoryId: category.id }))
      setCustomName(''); setCustomOpen(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新增失败') }
  }

  return (
    <Modal title={transaction ? '编辑这笔流水' : '记下一笔'} subtitle="认真记下，但不必过分苛责每一笔小开销。" onClose={onClose}>
      <form onSubmit={submit} className="transaction-form">
        <div className="type-switch" role="group" aria-label="流水类型"><button type="button" aria-pressed={type === 'expense'} className={type === 'expense' ? 'active expense' : ''} onClick={() => changeType('expense')}>支出</button><button type="button" aria-pressed={type === 'income'} className={type === 'income' ? 'active income' : ''} onClick={() => changeType('income')}>收入</button></div>
        <label className="amount-field"><span>金额</span><div><b aria-hidden="true">¥</b><input autoFocus data-dialog-autofocus inputMode="decimal" value={draft.amount} onChange={(e) => { setDraft({ ...draft, amount: e.target.value }); setError('') }} placeholder="0.00" aria-label="金额" aria-describedby={error ? 'transaction-error' : undefined} /></div></label>
        <fieldset><legend>分类</legend><div className="category-grid">{allowed.map((category) => <button type="button" key={category.id} aria-pressed={draft.categoryId === category.id} className={draft.categoryId === category.id ? 'selected' : ''} style={{ '--category': category.color } as React.CSSProperties} onClick={() => setDraft({ ...draft, categoryId: category.id })}><CategoryIcon name={category.icon} size={18} /><span>{category.name}</span></button>)}<button type="button" className="add-category" aria-expanded={customOpen} onClick={() => setCustomOpen(!customOpen)}><Plus size={18} /><span>新分类</span></button></div></fieldset>
        {customOpen && <div className="inline-create"><input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="分类名称" aria-label="新分类名称" maxLength={8} /><button type="button" onClick={createCategory}>添加分类</button></div>}
        <div className="form-row"><label><span>日期</span><input type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="日期" /></label><label><span>备注</span><input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={40} placeholder="这笔钱花在了…" aria-label="备注" /></label></div>
        {error && <p className="form-error" id="transaction-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">保存这笔<ArrowRight size={17} /></button></div>
      </form>
    </Modal>
  )
}

function DataModal({ month, onClose, announce }: { month: string; onClose: () => void; announce: (m: string) => void }) {
  const {
    transactions, categories, importRows, clearData, sync, createSyncRoom, joinSyncRoom,
    dismissPairing, syncNow, disconnectSync,
  } = useFinance()
  const [preview, setPreview] = useState<CsvParseResult | null>(null)
  const [includeDuplicates, setIncludeDuplicates] = useState(false)
  const [confirmClear, setConfirmClear] = useState('')
  const [pairingInput, setPairingInput] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [dataError, setDataError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!sync.pairingLink) { setQrDataUrl(''); return }
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(sync.pairingLink!, {
        width: 220,
        margin: 1,
        color: { dark: '#173e34', light: '#fffaf0' },
        errorCorrectionLevel: 'M',
      }))
      .then(setQrDataUrl)
      .catch(() => setSyncError('配对二维码生成失败'))
  }, [sync.pairingLink])

  const runSyncAction = async (action: () => Promise<unknown>, success?: string) => {
    setSyncBusy(true); setSyncError('')
    try {
      await action()
      if (success) announce(success)
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : '同步操作失败')
    } finally { setSyncBusy(false) }
  }

  const selectFile = async (file?: File) => {
    if (!file) return
    setDataError('')
    try {
      setPreview(parseTransactionsCsv(await file.text(), transactions, categories))
    } catch {
      setPreview(null)
      setDataError('无法读取这个 CSV 文件，请检查文件格式后重试')
    }
  }
  const exportRows = (onlyMonth: boolean) => {
    const rows = onlyMonth ? transactions.filter((item) => item.date.startsWith(month)) : transactions
    downloadCsv(transactionsToCsv(rows, categories), `零钱簿_${onlyMonth ? month : '全部流水'}_${todayIso()}.csv`)
    announce(`已导出 ${rows.length} 笔流水`)
  }
  const commitImport = async () => {
    if (!preview) return
    setDataError('')
    try {
      const count = await importRows(preview.valid, includeDuplicates)
      setPreview(null); announce(`成功导入 ${count} 笔流水`)
    } catch {
      setDataError('导入失败，本机原有流水未被更改，请修正文件后重试')
    }
  }
  const clear = async () => {
    const phrase = sync.paired ? '确认清空全部' : '确认清空'
    if (confirmClear !== phrase) return
    setDataError('')
    try {
      await clearData(); onClose(); announce(sync.paired ? '所有同步设备的财务数据将被清空' : '本机财务数据已清空')
    } catch {
      setDataError('清空失败，本机数据仍保留，请稍后重试')
    }
  }

  const statusText = {
    unavailable: '待配置', off: '未开启', connecting: '连接中', online: '已同步', offline: '离线', error: '需处理',
  }[sync.status]
  const clearPhrase = sync.paired ? '确认清空全部' : '确认清空'

  return (
    <Modal title="数据与分类" subtitle="账目优先保存在本机；开启同步后，只上传端到端加密的数据。" onClose={onClose} wide>
      <div className="data-sections">
        <section className="sync-section">
          <div className="section-icon sync-section-icon"><Smartphone size={20} /></div>
          <div>
            <div className="sync-title"><h3>手机电脑同步</h3><span className={`sync-status ${sync.status}`}>{sync.status === 'online' ? <Wifi size={12} /> : <WifiOff size={12} />}{statusText}</span></div>
            {!sync.available && <div className="sync-setup-note"><ShieldCheck size={17} /><div><strong>同步代码已就绪，还差服务地址</strong><p>按使用说明配置 Supabase 地址和发布密钥，账目才会离开本机。未配置时不会发送任何数据。</p></div></div>}
            {sync.available && sync.pendingPairingCode && !sync.paired && <div className="pairing-invite"><QrCodeIcon size={22} /><div><strong>收到一把账簿钥匙</strong><p>加入后，这台设备的账目会与原账簿合并。解密只在当前浏览器完成。</p><div className="button-row"><button className="primary-button small" disabled={syncBusy} onClick={() => runSyncAction(() => joinSyncRoom(sync.pendingPairingCode!), '这台设备已加入同步账簿')}>确认加入</button><button className="text-button" onClick={dismissPairing}>暂不加入</button></div></div></div>}
            {sync.available && !sync.paired && !sync.pendingPairingCode && <div className="sync-off-state"><p>在电脑上新建同步账簿，再用手机扫码；也可以粘贴另一台设备给出的配对链接。</p><div className="button-row"><button className="primary-button small" disabled={syncBusy} onClick={() => runSyncAction(() => createSyncRoom(), '同步账簿已建好')}>新建同步账簿</button></div><div className="pairing-input"><input value={pairingInput} onChange={(event) => setPairingInput(event.target.value)} placeholder="粘贴配对链接或配对码" aria-label="配对链接或配对码" /><button disabled={syncBusy || !pairingInput.trim()} onClick={() => runSyncAction(() => joinSyncRoom(pairingInput), '这台设备已加入同步账簿')}>加入</button></div></div>}
            {sync.available && sync.paired && <div className="sync-on-state">
              <div className="sync-pair-card">
                <div className="sync-qr">{qrDataUrl ? <img src={qrDataUrl} alt="同步账簿配对二维码" /> : <RefreshCw className="spin" size={25} />}</div>
                <div><strong>让另一台设备扫一扫</strong><p>只给自己的设备扫码。二维码相当于这本账的钥匙，请勿转发或截图公开。</p><div className="sync-meta"><span>{sync.status === 'online' ? '两端改动会实时到达' : '离线改动会排队补发'}</span><span>{sync.queued ? `待发送 ${sync.queued} 条` : '没有待发送改动'}</span>{sync.lastSyncedAt && <span>最近同步 {new Date(sync.lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}</div></div>
              </div>
              <div className="button-row sync-actions"><button className="paper-button" disabled={!sync.pairingLink} onClick={() => runSyncAction(async () => { await navigator.clipboard.writeText(sync.pairingLink!); announce('配对链接已复制') })}><Copy size={14} />复制配对链接</button><button className="paper-button" disabled={syncBusy} onClick={() => runSyncAction(syncNow, '同步检查完成')}><RefreshCw size={14} />立即同步</button><button className="text-button" disabled={syncBusy} onClick={() => { if (window.confirm('只断开这台设备？云端账簿和其他设备不会被删除。')) void runSyncAction(disconnectSync, '这台设备已断开同步') }}><Link2 size={14} />断开本机</button></div>
            </div>}
            {(syncError || sync.error) && <p className="sync-error" role="alert">{syncError || sync.error}</p>}
          </div>
        </section>
        <section><div className="section-icon"><Download size={20} /></div><div><h3>导出备份</h3><p>生成 Excel 可直接打开的 UTF-8 CSV 文件。</p><div className="button-row"><button className="paper-button" onClick={() => exportRows(true)}>导出本月</button><button className="paper-button" onClick={() => exportRows(false)}>导出全部</button></div></div></section>
        <section><div className="section-icon"><FileUp size={20} /></div><div><h3>导入流水</h3><p>字段顺序为：日期、类型、分类、金额、备注。导入前会先检查错误和重复。</p><input ref={inputRef} type="file" accept=".csv,text/csv" hidden aria-label="CSV 文件" onChange={(e) => selectFile(e.target.files?.[0])} /><button className="paper-button" onClick={() => inputRef.current?.click()}>选择 CSV 文件</button></div></section>
        <section className="danger-section"><div className="section-icon"><Trash2 size={20} /></div><div><h3>{sync.paired ? '清空同步账簿' : '清空本机数据'}</h3><p>{sync.paired ? '流水、预算和自定义分类会从所有已配对设备删除，无法撤销。' : '流水、预算和自定义分类会从本机永久删除，无法撤销。'}请输入“{clearPhrase}”。</p><div className="inline-create"><input value={confirmClear} onChange={(e) => setConfirmClear(e.target.value)} placeholder={clearPhrase} aria-label="清空确认文字" /><button disabled={confirmClear !== clearPhrase} onClick={clear}>永久清空</button></div></div></section>
      </div>
      {dataError && <p className="data-error" role="alert">{dataError}</p>}
      {preview && <ImportPreview result={preview} includeDuplicates={includeDuplicates} setIncludeDuplicates={setIncludeDuplicates} onCancel={() => setPreview(null)} onImport={commitImport} />}
    </Modal>
  )
}

function ImportPreview({ result, includeDuplicates, setIncludeDuplicates, onCancel, onImport }: { result: CsvParseResult; includeDuplicates: boolean; setIncludeDuplicates: (v: boolean) => void; onCancel: () => void; onImport: () => void }) {
  const duplicateCount = result.valid.filter((item) => item.isDuplicate).length
  const importCount = result.valid.filter((item) => includeDuplicates || !item.isDuplicate).length
  return <div className="import-preview" role="region" aria-labelledby="import-preview-title"><div className="preview-title"><div><h3 id="import-preview-title">导入预览</h3><p>{result.valid.length} 行有效 · {result.errors.length} 行错误 · {duplicateCount} 行疑似重复</p></div><button className="icon-button" onClick={onCancel} aria-label="关闭导入预览"><X size={18} /></button></div>{result.errors.length > 0 && <div className="error-list" role="alert">{result.errors.slice(0, 5).map((error) => <p key={`${error.rowNumber}-${error.message}`}>第 {error.rowNumber} 行：{error.message}</p>)}{result.errors.length > 5 && <p>另有 {result.errors.length - 5} 条错误未显示</p>}</div>}<label className="check-row"><input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />仍然导入疑似重复项</label><div className="modal-actions"><button className="text-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={!importCount} onClick={onImport}>确认导入 {importCount} 笔</button></div></div>
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)

  useEffect(() => {
    const previousFocus = returnFocusRef.current
    const frame = window.requestAnimationFrame(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]')
      const fallback = dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ;(preferred ?? fallback)?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus() })
    }
  }, [])

  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section ref={dialogRef} className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby="modal-title" onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, onClose)}><header><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>{children}</section></div>
}

function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null, onClose: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()
    return
  }
  if (event.key !== 'Tab' || !container) return
  const focusable = Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    .filter((item) => !item.hasAttribute('hidden'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function EmptyMini({ text }: { text: string }) { return <div className="empty-mini"><CircleHelp size={25} /><p>{text}</p></div> }
function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-mark">〽</div><h3>{title}</h3><p>{text}</p>{action}</div> }

export default App
