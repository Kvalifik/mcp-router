// Calendar keys represent the router's local day. Do arithmetic on the keys
// themselves so short and long days across DST still advance by one date.
export function localDay(time) {
  const date = new Date(time);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function offsetDay(day, offset) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(day) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  return offsetDay(day, -((weekday + 6) % 7));
}
