'use client'

import type { ComponentProps } from 'react'
import { cn } from '@/renderer/src/lib/utils'
import { mono, paper } from '@/renderer/src/lib/surfaces'

export interface DataTableProps extends Omit<ComponentProps<'div'>, 'children'> {
  columns: readonly string[]
  rows: readonly (readonly (string | number | boolean | null)[])[]
  cycle: number
}

export function DataTable({ columns, rows, cycle, className, ...props }: DataTableProps) {
  return (
    <div
      data-slot="data-table"
      className={cn(paper, 'w-full overflow-hidden rounded-2xl text-[13px]', className)}
      {...props}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-foreground/[0.06] border-b">
              {columns.map((column) => (
                <th
                  key={column}
                  className={cn(mono, 'text-foreground/45 px-4 py-2.5 text-left font-medium')}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody key={cycle}>
            {rows.map((row, index) => (
              <tr
                key={index}
                className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both hover:bg-foreground/[0.03] border-foreground/[0.04] border-b transition-colors duration-300 last:border-0"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                {columns.map((_, columnIndex) => (
                  <td key={columnIndex} className="text-foreground/80 px-4 py-2.5">
                    {row[columnIndex] == null ? '' : String(row[columnIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
