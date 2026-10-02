import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

// Only decorative icons and text belong here: outgoing content is hidden from
// assistive technology while the current value takes effect immediately.
export class AnimatedSwap extends React.Component {
  state = { value: this.props.value, current: this.props.children, previous: null };
  root = React.createRef();
  current = React.createRef();
  previous = React.createRef();
  animations = [];

  static getDerivedStateFromProps(props, state) {
    return props.value !== state.value
      ? { value: props.value, current: props.children, previous: state.current }
      : { current: props.children };
  }

  componentDidUpdate(previous) {
    if (previous.value === this.props.value) return;
    this.animations.forEach(animation => animation.cancel());
    this.animations = [];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setState({ previous: null });
      return;
    }
    const timing = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
    const icon = this.props.icon;
    const incoming = this.current.current.animate([
      { opacity: 0, transform: icon ? 'scale(0.5)' : 'none' },
      { opacity: 1, transform: 'none' },
    ], timing);
    this.animations.push(incoming);
    if (this.previous.current) this.animations.push(this.previous.current.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: icon ? 'scale(0.5)' : 'none' },
    ], { ...timing, fill: 'forwards' }));
    incoming.onfinish = () => this.setState({ previous: null });
  }

  componentWillUnmount() { this.animations.forEach(animation => animation.cancel()); }

  render() {
    return <span ref={this.root} className={cn('animated-swap', this.props.icon && 'animated-swap-icon', this.props.className)} aria-hidden={this.props.icon || undefined}>
      {this.state.previous !== null && <span ref={this.previous} className="animated-swap-layer animated-swap-exit" aria-hidden="true" inert>{this.state.previous}</span>}
      <span ref={this.current} className="animated-swap-layer">{this.props.children}</span>
    </span>;
  }
}

// Adapted from Motion Primitives Text Morph and Text Effect (MIT, ibelick).
// See licenses/motion-primitives.txt. Motion owns presence and layout transitions.
export function AnimatedText({ children, className, ...props }) {
  const reduced = useReducedMotion();
  const id = React.useId();
  const text = String(children ?? '');
  const characters = React.useMemo(() => {
    const counts = new Map();
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => {
      const count = (counts.get(segment) || 0) + 1;
      counts.set(segment, count);
      return { key: `${id}-${segment}-${count}`, label: segment === ' ' ? '\u00a0' : segment };
    });
  }, [text, id]);
  if (reduced) return <span className={className} {...props}>{text}</span>;
  return <span className={cn('relative inline-block align-top', className)} {...props}>
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        {characters.map(character => <motion.span key={character.key} layout="position" layoutDependency={text}
          className="inline-block" initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}
          transition={{ layout: { type: 'spring', stiffness: 280, damping: 26, mass: 0.3 }, opacity: { duration: 0.15 }, y: { duration: 0.18 } }}>
          {character.label}
        </motion.span>)}
      </AnimatePresence>
    </span>
  </span>;
}

const RevealContext = React.createContext(true);
export function AnimatedWords({ children }) {
  const show = React.useContext(RevealContext);
  const reduced = useReducedMotion();
  const text = String(children ?? '');
  const parts = text.split(/(\s+)/);
  if (reduced) return text;
  let index = 0;
  return <><span className="sr-only">{text}</span><span aria-hidden="true">{parts.map((part, key) =>
    /^\s+$/.test(part) ? part : <motion.span key={`${key}-${part}`} className="inline-block"
      initial={{ opacity: 0, y: 3 }} animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 3 }}
      transition={{ duration: 0.18, delay: show ? Math.min(index++ * 0.025, 0.125) : 0, ease: 'easeOut' }}>
      {part}
    </motion.span>
  )}</span></>;
}

// Keep the outgoing help text during collapse; hide it semantically immediately.
export function AnimatedReveal({ show, children, className }) {
  const last = React.useRef(children);
  React.useLayoutEffect(() => { if (show) last.current = children; }, [show, children]);
  return <div className={cn('animated-reveal', className)} data-open={!!show} aria-hidden={!show || undefined} inert={!show || undefined}>
    <div><RevealContext.Provider value={!!show}>{show ? children : last.current}</RevealContext.Provider></div>
  </div>;
}
