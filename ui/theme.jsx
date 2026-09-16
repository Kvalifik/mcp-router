import React, {createContext,useContext,useEffect,useState} from 'react';
const ThemeContext=createContext(null);
const key='webflow-router-appearance';
function initialTheme(){try{const saved=localStorage.getItem(key);return ['system','light','dark'].includes(saved)?saved:'system';}catch{return 'system';}}
export function ThemeProvider({children}){
 const [theme,setTheme]=useState(initialTheme);
 const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(()=>{window.routerDesktop?.setTheme(theme).catch(()=>{});},[theme]);
 const resolved=theme==='system'?(systemDark?'dark':'light'):theme;
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const update=()=>setSystemDark(media.matches);media.addEventListener('change',update);update();return()=>media.removeEventListener('change',update);},[]);
 React.useLayoutEffect(()=>{document.documentElement.classList.toggle('dark',resolved==='dark');document.documentElement.style.colorScheme=resolved;},[resolved]);
 const select=value=>{if(!['system','light','dark'].includes(value))return;setTheme(value);try{localStorage.setItem(key,value);}catch{}};
 return <ThemeContext.Provider value={{theme,resolved,setTheme:select}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);
