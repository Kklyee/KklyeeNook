'use client'

import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/utils'

function flattenTreeItems(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return flattenTreeItems(child.props.children)
    }
    return [child]
  })
}

function BranchListRoot({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      data-slot="branch-list-root"
      className={cn('aui-branch-list-root', className)}
    />
  )
}

function BranchListTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      data-slot="branch-list-trigger"
      className={cn('aui-branch-list-trigger', className)}
    />
  )
}

function BranchListItems({ children, className, ...props }: ComponentProps<'div'>) {
  const items = flattenTreeItems(children)

  return (
    <div
      {...props}
      data-slot="branch-list-items"
      className={cn('aui-branch-list-items', className)}
    >
      {items.map((item, index) => (
        <div key={isValidElement(item) ? item.key ?? index : index} data-slot="branch-list-item" className="aui-branch-list-item">
          {item}
        </div>
      ))}
    </div>
  )
}

const BranchList = {
  Root: BranchListRoot,
  Trigger: BranchListTrigger,
  Items: BranchListItems,
}

export { BranchList, BranchListRoot, BranchListTrigger, BranchListItems }
