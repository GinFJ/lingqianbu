import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useFinance } from '../context/FinanceContext'
import { categoryTotals, formatMoney, monthLabel, recentMonths, summarizeMonth } from '../lib/finance'

export default function ReportsPage({ month }: { month: string }) {
  const { transactions, categories } = useFinance()
  const months = recentMonths(month, 12)
  const monthly = months.map((item) => {
    const summary = summarizeMonth(transactions, item)
    return {
      month: `${Number(item.slice(5))}月`,
      income: summary.income / 100,
      expense: summary.expense / 100,
      incomeCents: summary.income,
      expenseCents: summary.expense,
    }
  })
  const totals = categoryTotals(transactions, categories, month)
  const current = summarizeMonth(transactions, month)
  const previousMonth = recentMonths(month, 2)[0]
  const previous = summarizeMonth(transactions, previousMonth)
  const expenseDelta = previous.expense ? Math.round((current.expense - previous.expense) / previous.expense * 100) : null
  const top = totals[0]

  return (
    <>
      <div className="page-heading"><span>月度复盘</span><h1>数字背后，是生活的形状。</h1><p>从趋势和分类中读一读你的{monthLabel(month)}。</p></div>
      {current.count === 0 ? <div className="paper-card"><EmptyState /></div> : (
        <>
          <section className="insight-strip">
            <div><span>本月结余率</span><strong>{current.income ? `${Math.round(current.balance / current.income * 100)}%` : '—'}</strong><small>结余 ÷ 收入</small></div>
            <div><span>较上月支出</span><strong className={expenseDelta !== null && expenseDelta > 0 ? 'danger' : ''}>{expenseDelta === null ? '—' : `${expenseDelta > 0 ? '+' : ''}${expenseDelta}%`}</strong><small>{expenseDelta === null ? '上月暂无数据' : expenseDelta > 0 ? '支出有所增加' : '支出有所减少'}</small></div>
            <div><span>最大支出类别</span><strong>{top?.name ?? '—'}</strong><small>{top ? formatMoney(top.value) : '暂无'}</small></div>
          </section>
          <section className="report-grid">
            <div className="paper-card year-chart">
              <CardHeader title="十二个月收支" subtitle="观察长期的起伏，而不是被单日数字牵动" />
              <figure className="accessible-chart">
                <div className="chart-area tall" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}><CartesianGrid vertical={false} stroke="#dfdacd" strokeDasharray="3 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#77736a' }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#77736a' }} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="income" name="收入" fill="#39716a" radius={[4, 4, 0, 0]} /><Bar dataKey="expense" name="支出" fill="#c8624a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                <figcaption className="sr-only">十二个月收入与支出柱状图。详细数值如下。</figcaption>
                <table className="sr-only"><caption>十二个月收支明细</caption><thead><tr><th scope="col">月份</th><th scope="col">收入</th><th scope="col">支出</th></tr></thead><tbody>{monthly.map((item) => <tr key={item.month}><th scope="row">{item.month}</th><td>{formatMoney(item.incomeCents)}</td><td>{formatMoney(item.expenseCents)}</td></tr>)}</tbody></table>
              </figure>
            </div>
            <div className="paper-card category-chart">
              <CardHeader title="支出去向" subtitle={`${monthLabel(month)}分类占比`} />
              <figure className="accessible-chart">
                <div className="donut-wrap" aria-hidden="true"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={totals} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">{totals.map((entry) => <Cell key={entry.categoryId} fill={entry.color} />)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value))} /></PieChart></ResponsiveContainer><div className="donut-center"><span>支出合计</span><strong>{formatMoney(current.expense)}</strong></div></div><div className="legend-list">{totals.slice(0, 6).map((item) => <div key={item.categoryId}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{current.expense ? `${Math.round(item.value / current.expense * 100)}%` : '0%'}</strong></div>)}</div></div>
                <figcaption className="sr-only">{monthLabel(month)}支出分类占比。详细数值如下。</figcaption>
                <table className="sr-only"><caption>{monthLabel(month)}支出分类明细</caption><thead><tr><th scope="col">分类</th><th scope="col">金额</th><th scope="col">占比</th></tr></thead><tbody>{totals.map((item) => <tr key={item.categoryId}><th scope="row">{item.name}</th><td>{formatMoney(item.value)}</td><td>{current.expense ? `${Math.round(item.value / current.expense * 100)}%` : '0%'}</td></tr>)}</tbody></table>
              </figure>
            </div>
          </section>
        </>
      )}
    </>
  )
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="card-header"><div><h2>{title}</h2><p>{subtitle}</p></div></header>
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}：{formatMoney(item.value * 100)}</span>)}</div>
}

function EmptyState() {
  return <div className="empty-state"><div className="empty-mark">〽</div><h3>本月还没有可分析的数据</h3><p>报表会在你记账后自动生成，不需要额外整理。</p></div>
}
