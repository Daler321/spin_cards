import { type HTMLAttributes, useRef } from 'react';
import { useDragScroll } from '../lib/useDragScroll';

/** A horizontal strip that a desktop mouse can scroll with the wheel and drag. */
export function ScrollStrip(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useDragScroll(ref);
  return <div ref={ref} {...props} />;
}
