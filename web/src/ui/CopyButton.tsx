import { useState } from 'react';
import { Icon } from './Icon.tsx';

export function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-quiet btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard can be denied; the text is selectable on the page */
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {done ? '복사됨' : label}
    </button>
  );
}
