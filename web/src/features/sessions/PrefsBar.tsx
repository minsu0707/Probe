import { useEffect, useRef, useState } from 'react';
import { api } from '../../core/api.ts';
import { attempt } from '../../core/store.ts';
import { ConfirmModal, Icon } from '../../ui/index.ts';
import { DEFAULT_PREFS, EFFORT_INFO, MODE_INFO, MODEL_INFO, SESSION_EFFORTS, SESSION_MODELS, SESSION_MODES, type SessionPrefs } from '../../../../shared/session-prefs.ts';

interface Option {
  value: string;
  label: string;
  tip: string;
  risky?: boolean;
}

const options = <K extends string>(keys: readonly K[], info: Record<K, { label: string; tip: string; risky?: boolean }>): Option[] => keys.map((k) => ({ value: k, ...info[k] }));
const MODES = options(SESSION_MODES, MODE_INFO);
const MODELS = options(SESSION_MODELS, MODEL_INFO);
const EFFORTS = options(SESSION_EFFORTS, EFFORT_INFO);

/**
 * One chip that opens a short list. Hovering or focusing an entry explains it in Korean underneath,
 * which a native <select> cannot do. Closes on outside click and Escape.
 */
function Choice({ name, value, items, onPick }: { name: string; value: string; items: Option[]; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.value === value) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="pref" ref={root}>
      <button className={`pref-chip${current.risky ? ' risky' : ''}`} aria-haspopup="menu" aria-expanded={open} title={current.tip} onClick={() => setOpen(!open)}>
        <span className="pref-name">{name}</span>
        <strong>{current.label}</strong>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="pref-menu" role="menu" onMouseLeave={() => setHint(null)}>
          {items.map((i) => (
            <button
              key={i.value}
              role="menuitemradio"
              aria-checked={i.value === value}
              className={`pref-item${i.risky ? ' risky' : ''}`}
              onMouseEnter={() => setHint(i.tip)}
              onFocus={() => setHint(i.tip)}
              onClick={() => {
                setOpen(false);
                setHint(null);
                onPick(i.value);
              }}
            >
              <span className="pref-check">{i.value === value && <Icon name="check" size={13} />}</span>
              {i.label}
            </button>
          ))}
          <p className="pref-hint muted small">{hint ?? current.tip}</p>
        </div>
      )}
    </div>
  );
}

/** Permission mode, model and thinking depth of the Claude sessions of this service. The choice is kept per service, so a new session starts with it too. */
export function PrefsBar({ serviceId }: { serviceId: string }) {
  const [prefs, setPrefs] = useState<SessionPrefs>(DEFAULT_PREFS);
  const [askBypass, setAskBypass] = useState(false);

  useEffect(() => {
    let alive = true;
    api.sessionPrefs(serviceId).then((p) => alive && setPrefs(p), () => undefined);
    return () => {
      alive = false;
    };
  }, [serviceId]);

  const save = async (change: Partial<SessionPrefs>) => {
    const next = await attempt(() => api.setSessionPrefs(serviceId, change));
    if (next) setPrefs(next);
  };
  const pickMode = (mode: string) => (mode === 'bypassPermissions' && prefs.mode !== 'bypassPermissions' ? setAskBypass(true) : void save({ mode: mode as SessionPrefs['mode'] }));

  return (
    <div className="prefs-bar">
      <Choice name="Mode" value={prefs.mode} items={MODES} onPick={pickMode} />
      <Choice name="Model" value={prefs.model} items={MODELS} onPick={(model) => void save({ model: model as SessionPrefs['model'] })} />
      <Choice name="Effort" value={prefs.effort} items={EFFORTS} onPick={(effort) => void save({ effort: effort as SessionPrefs['effort'] })} />
      <span className="muted small">다음 메시지부터 적용 · 이 서비스의 모든 세션에 공통</span>
      {askBypass && (
        <ConfirmModal title="Bypass permissions 켜기" confirm="켜기" onConfirm={() => save({ mode: 'bypassPermissions' })} onClose={() => setAskBypass(false)}>
          Claude가 확인 없이 모든 도구를 실행합니다. 셸 명령과 웹 접근도 열리고, 실행한 일은 되돌릴 수 없습니다. 조회 전용 서비스에서는 셸과 웹이 계속 막혀 있습니다.
        </ConfirmModal>
      )}
    </div>
  );
}
