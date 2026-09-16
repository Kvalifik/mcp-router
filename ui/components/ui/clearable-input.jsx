import * as React from 'react';
import { X, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Compose shadcn controls without changing the base Input component.
export function ClearableInput({className,inputClassName,value,onClear,search=false,...props}) {
  const ref=React.useRef(null);
  const hasValue=value!==undefined && value!==null && String(value).length>0;
  const label=props['aria-label'] || (props.id==='item-name'?'display name':'input');
  return <div className={cn('relative w-full min-w-0',className)}>
    <Input {...props} ref={ref} value={value} className={cn(inputClassName,'pr-8',search&&'pl-8')} />
    {search&&<Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />}
    {hasValue&&!props.disabled&&!props.readOnly&&<Button type="button" variant="ghost" size="icon-xs" className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground" title={`Clear ${label}`} aria-label={`Clear ${label}`} onMouseDown={e=>e.preventDefault()} onClick={()=>{onClear();ref.current?.focus();}}><X className="size-3.5" /></Button>}
  </div>;
}
