import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  label?: string;
}

export function Card({ children, className = '', as: Tag = 'section', label }: CardProps) {
  return (
    <Tag className={`card ${className}`} aria-label={label}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  icon?: LucideIcon;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ icon: Icon, title, action, className = '' }: CardHeaderProps) {
  return (
    <header className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={15} className="text-ink-3 shrink-0" aria-hidden />}
        <h2 className="label truncate">{title}</h2>
      </div>
      {action}
    </header>
  );
}
