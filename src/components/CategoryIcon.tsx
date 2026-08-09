import {
  BookOpen, BriefcaseBusiness, Bus, CirclePlus, Coffee, Ellipsis, Gamepad2, Gift,
  HeartPulse, House, ShoppingBag, Tag, TrendingUp, Utensils, type LucideProps,
} from 'lucide-react'

const icons = {
  BookOpen, BriefcaseBusiness, Bus, CirclePlus, Coffee, Ellipsis, Gamepad2, Gift,
  HeartPulse, House, ShoppingBag, Tag, TrendingUp, Utensils,
}

export function CategoryIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = icons[name as keyof typeof icons] ?? Tag
  return <Icon {...props} />
}
