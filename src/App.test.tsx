import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { FinanceProvider } from './context/FinanceContext'
import { db, repository } from './data/db'
import { currentMonth, monthLabel, todayIso } from './lib/finance'
import { syncService } from './sync/service'

vi.mock('recharts', () => {
  const ChartStub = ({ children }: { children?: ReactNode }) => <>{children}</>

  return {
    Bar: ChartStub,
    BarChart: ChartStub,
    CartesianGrid: ChartStub,
    Cell: ChartStub,
    Pie: ChartStub,
    PieChart: ChartStub,
    ResponsiveContainer: ChartStub,
    Tooltip: ChartStub,
    XAxis: ChartStub,
    YAxis: ChartStub,
  }
})

function csvFile(text: string, name = '导入测试.csv') {
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) })
  return file
}

describe('首次记账流程', () => {
  beforeEach(async () => {
    await db.open()
    await repository.clearUserData()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('从空账簿打开记账表单并校验金额', async () => {
    render(<FinanceProvider><App /></FinanceProvider>)
    const firstButton = await screen.findByRole('button', { name: /记下第一笔/ })
    fireEvent.click(firstButton)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /保存这笔/ }))
    expect(await screen.findByText(/请输入大于 0/)).toBeInTheDocument()
  })

  it('对话框自动聚焦、可用 Escape 关闭并把焦点还给触发按钮', async () => {
    render(<FinanceProvider><App /></FinanceProvider>)
    const trigger = (await screen.findAllByRole('button', { name: '记一笔' }))[0]
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByLabelText('金额')).toHaveFocus())

    const closeButton = screen.getByRole('button', { name: '关闭' })
    const saveButton = screen.getByRole('button', { name: /保存这笔/ })
    closeButton.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(saveButton).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(closeButton).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('导航到预算页面并显示内置支出分类', async () => {
    render(<FinanceProvider><App /></FinanceProvider>)
    const budgetButtons = await screen.findAllByRole('button', { name: '预算' })
    fireEvent.click(budgetButtons[0])
    await waitFor(() => expect(screen.getByText('预算不是束缚，是提前做的选择。')).toBeInTheDocument())
    expect(screen.getAllByText('餐饮').length).toBeGreaterThan(0)
  })

  it('在数据面板显示端到端加密同步入口', async () => {
    render(<FinanceProvider><App /></FinanceProvider>)
    const dataButtons = await screen.findAllByRole('button', { name: '数据与分类' })
    fireEvent.click(dataButtons[0])
    expect(await screen.findByText('手机电脑同步')).toBeInTheDocument()
    if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
      expect(screen.getByRole('button', { name: '新建同步账簿' })).toBeInTheDocument()
    } else {
      expect(screen.getByText('同步代码已就绪，还差服务地址')).toBeInTheDocument()
    }
  })

  it('同步入队失败时仍保留本机已确认流水', async () => {
    vi.spyOn(syncService, 'enqueue').mockRejectedValueOnce(new Error('测试网络不可用'))
    render(<FinanceProvider><App /></FinanceProvider>)
    fireEvent.click(await screen.findByRole('button', { name: /记下第一笔/ }))
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '8.88' } })
    fireEvent.change(screen.getByPlaceholderText('这笔钱花在了…'), { target: { value: '本机优先' } })
    fireEvent.click(screen.getByRole('button', { name: /保存这笔/ }))

    await waitFor(() => expect(db.transactions.count()).resolves.toBe(1))
    expect((await db.transactions.toCollection().first())?.note).toBe('本机优先')
  })

  it('编辑和删除流水时同步更新本机记录与对应同步事件', async () => {
    const now = new Date().toISOString()
    await db.transactions.put({
      id: 'transaction-edit', type: 'expense', amountCents: 1200,
      categoryId: 'expense-food', date: todayIso(), note: '初始早餐', createdAt: now, updatedAt: now,
    })
    const enqueue = vi.spyOn(syncService, 'enqueue').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<FinanceProvider><App /></FinanceProvider>)

    fireEvent.click((await screen.findAllByRole('button', { name: '流水' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '编辑 初始早餐' }))
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '18.88' } })
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '改后早餐' } })
    fireEvent.click(screen.getByRole('button', { name: /保存这笔/ }))

    await waitFor(async () => expect((await db.transactions.get('transaction-edit'))?.amountCents).toBe(1888))
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'put_transaction', transaction: expect.objectContaining({ id: 'transaction-edit', note: '改后早餐' }) }))

    fireEvent.click(await screen.findByRole('button', { name: '删除 改后早餐' }))
    await waitFor(async () => expect(await db.transactions.get('transaction-edit')).toBeUndefined())
    expect(enqueue).toHaveBeenCalledWith({ kind: 'delete_transaction', id: 'transaction-edit' })
  })

  it('预算新增、编辑和删除都会写入正确同步事件', async () => {
    const enqueue = vi.spyOn(syncService, 'enqueue').mockResolvedValue(undefined)
    render(<FinanceProvider><App /></FinanceProvider>)
    fireEvent.click((await screen.findAllByRole('button', { name: '预算' }))[0])
    const input = await screen.findByLabelText('餐饮预算')

    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: '保存餐饮预算' }))
    await waitFor(async () => expect((await db.budgets.get(`${currentMonth()}:expense-food`))?.limitCents).toBe(50000))
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'put_budget', budget: expect.objectContaining({ limitCents: 50000 }) }))

    fireEvent.change(input, { target: { value: '650.50' } })
    fireEvent.click(screen.getByRole('button', { name: '保存餐饮预算' }))
    await waitFor(async () => expect((await db.budgets.get(`${currentMonth()}:expense-food`))?.limitCents).toBe(65050))

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存餐饮预算' }))
    await waitFor(async () => expect(await db.budgets.get(`${currentMonth()}:expense-food`)).toBeUndefined())
    expect(enqueue).toHaveBeenCalledWith({ kind: 'delete_budget', id: `${currentMonth()}:expense-food` })
  })

  it('自定义分类保持流水依赖，清空后移除用户数据并恢复内置分类', async () => {
    const enqueue = vi.spyOn(syncService, 'enqueue').mockResolvedValue(undefined)
    render(<FinanceProvider><App /></FinanceProvider>)
    fireEvent.click(await screen.findByRole('button', { name: /记下第一笔/ }))
    fireEvent.click(screen.getByRole('button', { name: '新分类' }))
    fireEvent.change(screen.getByLabelText('新分类名称'), { target: { value: '咖啡豆' } })
    fireEvent.click(screen.getByRole('button', { name: '添加分类' }))
    expect(await screen.findByRole('button', { name: '咖啡豆' }, { timeout: 5000 })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '36.50' } })
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '手冲练习' } })
    fireEvent.click(screen.getByRole('button', { name: /保存这笔/ }))

    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
    const transaction = await db.transactions.toCollection().first()
    const customCategory = transaction ? await db.categories.get(transaction.categoryId) : undefined
    expect(customCategory).toMatchObject({ name: '咖啡豆', isBuiltin: false })

    fireEvent.click((await screen.findAllByRole('button', { name: '数据与分类' }))[0])
    fireEvent.change(await screen.findByLabelText('清空确认文字'), { target: { value: '确认清空' } })
    fireEvent.click(screen.getByRole('button', { name: '永久清空' }))
    await waitFor(async () => expect(await db.transactions.count()).toBe(0))
    expect(await db.budgets.count()).toBe(0)
    expect((await db.categories.toArray()).filter((category) => !category.isBuiltin)).toHaveLength(0)
    expect(await db.categories.get('expense-food')).toMatchObject({ name: '餐饮', isBuiltin: true })
    expect(enqueue).toHaveBeenCalledWith({ kind: 'clear_data' })
  })

  it('CSV 错误预览后可重新选择正确文件并确认导入', async () => {
    const enqueue = vi.spyOn(syncService, 'enqueue').mockResolvedValue(undefined)
    render(<FinanceProvider><App /></FinanceProvider>)
    fireEvent.click((await screen.findAllByRole('button', { name: '数据与分类' }))[0])
    const input = await screen.findByLabelText('CSV 文件')

    fireEvent.change(input, { target: { files: [csvFile('日期,类型,分类,金额,备注\n2026-08-10,支出,餐饮,错误金额,坏行')] } })
    expect(await screen.findByText(/第 2 行：金额必须/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认导入 0 笔' })).toBeDisabled()

    fireEvent.change(input, { target: { files: [csvFile('日期,类型,分类,金额,备注\n2026-08-10,支出,学习,12.34,正确行')] } })
    const confirm = await screen.findByRole('button', { name: '确认导入 1 笔' })
    fireEvent.click(confirm)
    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
    expect((await db.transactions.toCollection().first())?.amountCents).toBe(1234)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'snapshot' }))
  })

  it('总览趋势提供可被辅助技术读取的数值明细', async () => {
    const now = new Date().toISOString()
    await db.transactions.put({
      id: 'transaction-chart', type: 'expense', amountCents: 4321,
      categoryId: 'expense-study', date: todayIso(), note: '图表替代信息', createdAt: now, updatedAt: now,
    })
    render(<FinanceProvider><App /></FinanceProvider>)
    expect(await screen.findByRole('table', { name: '近六个月收支明细' })).toBeInTheDocument()
  })

  it('懒加载报表提供可被辅助技术读取的数值明细', async () => {
    const now = new Date().toISOString()
    await db.transactions.put({
      id: 'transaction-report', type: 'expense', amountCents: 4321,
      categoryId: 'expense-study', date: todayIso(), note: '报表替代信息', createdAt: now, updatedAt: now,
    })
    render(<FinanceProvider><App /></FinanceProvider>)
    fireEvent.click((await screen.findAllByRole('button', { name: '报表' }))[0])
    expect(await screen.findByRole('table', { name: '十二个月收支明细' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: `${monthLabel(currentMonth())}支出分类明细` })).toBeInTheDocument()
  })
})
