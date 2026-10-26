import { useId, useRef, useState, type DragEvent } from 'react';
import { Icon } from './Icon.tsx';

/** Drag-and-drop target that also works as a click-to-choose file picker. */
export function FileDrop({ onFiles, accept, multiple, label, hint, busy }: { onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; label: string; hint?: string; busy?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div className={`drop${over ? ' drop-over' : ''}${busy ? ' drop-busy' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
      <input
        id={id}
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ''; // lets the same file be chosen again after an error
          if (files.length) onFiles(files);
        }}
      />
      <Icon name="upload" size={20} />
      <div>
        <label htmlFor={id} className="drop-label">
          {busy ? '올리는 중…' : label}
        </label>
        {hint && <div className="muted small">{hint}</div>}
      </div>
    </div>
  );
}
