// Accept display data and return an action ID. Menus never execute renderer code.
function menuTemplate(items, select, icons = {}, depth = 0, budget = {remaining:100}, ids = new Set()) {
  if (!Array.isArray(items) || depth > 3) throw new Error('Invalid menu');
  return items.map(item => {
    if (--budget.remaining < 0 || !item || typeof item !== 'object') throw new Error('Invalid menu');
    if (item.separator === true) return {type:'separator'};
    if (typeof item.label !== 'string' || item.label.length > 100 || !item.label) throw new Error('Invalid menu');
    if(item.icon !== undefined && !Object.hasOwn(icons,item.icon))throw new Error('Invalid menu icon');
    const icon = item.icon ? {icon:icons[item.icon]} : {};
    if (item.children) return {label:item.label, ...icon, submenu:menuTemplate(item.children,select,icons,depth+1,budget,ids)};
    if (typeof item.id !== 'string' || !/^[a-z-]{1,60}$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid menu action');
    ids.add(item.id);
    if(item.disabled !== undefined && typeof item.disabled !== 'boolean')throw new Error('Invalid menu state');
    if (item.checked !== undefined && typeof item.checked !== 'boolean') throw new Error('Invalid menu state');
    return {label:item.label, ...icon, enabled:!item.disabled, ...(item.checked === undefined ? {} : {type:'checkbox',checked:item.checked}), click:()=>select(item.id)};
  });
}
module.exports = {menuTemplate};
