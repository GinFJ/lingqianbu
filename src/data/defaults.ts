import type { Category } from '../types'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'expense-food', name: '餐饮', type: 'expense', color: '#c8624a', icon: 'Utensils', isBuiltin: true },
  { id: 'expense-transport', name: '交通', type: 'expense', color: '#39716a', icon: 'Bus', isBuiltin: true },
  { id: 'expense-shopping', name: '购物', type: 'expense', color: '#a76b3f', icon: 'ShoppingBag', isBuiltin: true },
  { id: 'expense-home', name: '居住', type: 'expense', color: '#6d7047', icon: 'House', isBuiltin: true },
  { id: 'expense-study', name: '学习', type: 'expense', color: '#486884', icon: 'BookOpen', isBuiltin: true },
  { id: 'expense-health', name: '医疗', type: 'expense', color: '#a24d58', icon: 'HeartPulse', isBuiltin: true },
  { id: 'expense-fun', name: '娱乐', type: 'expense', color: '#875d83', icon: 'Gamepad2', isBuiltin: true },
  { id: 'expense-other', name: '其他支出', type: 'expense', color: '#77736a', icon: 'Ellipsis', isBuiltin: true },
  { id: 'income-salary', name: '工资', type: 'income', color: '#2f6955', icon: 'BriefcaseBusiness', isBuiltin: true },
  { id: 'income-parttime', name: '兼职', type: 'income', color: '#4a7c59', icon: 'Coffee', isBuiltin: true },
  { id: 'income-gift', name: '红包', type: 'income', color: '#b55342', icon: 'Gift', isBuiltin: true },
  { id: 'income-invest', name: '理财收益', type: 'income', color: '#80722f', icon: 'TrendingUp', isBuiltin: true },
  { id: 'income-other', name: '其他收入', type: 'income', color: '#60766b', icon: 'CirclePlus', isBuiltin: true },
]

export const CATEGORY_COLORS = ['#c8624a', '#39716a', '#a76b3f', '#486884', '#875d83', '#6d7047']
