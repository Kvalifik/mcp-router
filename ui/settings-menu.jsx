import React from 'react';
import { ChevronDown, Settings2, SunMoon, PanelTop, Monitor, Server, ArrowDownUp, ShieldCheck, Activity, RefreshCw, Info, Pencil, Trash2, MessageSquare, Code2, Terminal, Plus, Copy, Check, TriangleAlert } from 'lucide-react';
import { Button } from './components/ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem } from './components/ui/dropdown-menu';
import { toast } from 'sonner';

const icons={SunMoon,PanelTop,Monitor,Server,ArrowDownUp,ShieldCheck,Activity,RefreshCw,Info,Pencil,Trash2,MessageSquare,Code2,Terminal,Plus,Copy,Check,TriangleAlert};
function ItemIcon({name}){const Icon=icons[name];return Icon?<Icon className="size-4" />:null;}

export function ActionMenu({items, trigger}) {
  const native = window.routerDesktop?.showNativeMenu;
  const open = async event=>{
    if(trigger.props.disabled)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const actions=new Map();
    const serialize=entries=>entries.map(({onSelect,children,...item})=>{
      if(onSelect)actions.set(item.id,onSelect);
      return {...item,...(children?{children:serialize(children)}:{})};
    });
    try {
      const id=await window.routerDesktop.showNativeMenu({items:serialize(items),x:Math.round(rect.left),y:Math.round(rect.bottom+4)});
      if(id)await actions.get(id)?.();
    } catch {toast.error('Could not open or apply the menu selection.');}
  };
  const button = native ? React.cloneElement(trigger, {onClick:open,onKeyDown:event=>{if(event.key==='ArrowDown'){event.preventDefault();open(event);}},'aria-haspopup':'menu'}) : trigger;
  if(native)return button;
  const render=entries=>entries.map((item,index)=>item.separator?<DropdownMenuSeparator key={`separator-${index}`} />:item.children?<DropdownMenuSub key={item.label}><DropdownMenuSubTrigger><ItemIcon name={item.icon} />{item.label}</DropdownMenuSubTrigger><DropdownMenuSubContent>{render(item.children)}</DropdownMenuSubContent></DropdownMenuSub>:item.checked!==undefined?<DropdownMenuCheckboxItem key={item.id} disabled={item.disabled} checked={item.checked} onSelect={item.onSelect}><ItemIcon name={item.icon} />{item.label}</DropdownMenuCheckboxItem>:<DropdownMenuItem key={item.id} disabled={item.disabled} variant={item.variant} onSelect={item.onSelect}><ItemIcon name={item.icon} />{item.label}</DropdownMenuItem>);
  return <DropdownMenu><DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={20}>{render(items)}</DropdownMenuContent></DropdownMenu>;
}

export function SettingsMenu({items,disabled}) {
  return <ActionMenu items={items} trigger={<Button className="app-settings-menu" variant="outline" size="sm" disabled={disabled} aria-label="Settings" title="Settings"><Settings2 className="size-4" /><ChevronDown className="size-3" aria-hidden="true" /></Button>} />;
}
