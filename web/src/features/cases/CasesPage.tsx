import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ServiceOverview, type TestCase, type TrashedCase } from '../../core/api.ts';
import { ago } from '../../core/format.ts';
import { goService } from '../../app/router.ts';
import { useStore, attempt } from '../../core/store.ts';
import { ConfirmModal, Empty, Icon, Pill } from '../../ui/index.ts';

/** 테스트 케이스: what Claude wrote, grouped by feature, with a choice of what to run. */
export function CasesPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  if (!service) return <Empty title="서비스를 먼저 등록하세요">서비스를 등록하면 Claude가 쓴 테스트 케이스를 이곳에서 볼 수 있습니다.</Empty>;
  return <CasesBody key={service.id} service={service} />;
}

function CasesBody({ service }: { service: ServiceOverview }) {
  const [cases, setCases] = useState<TestCase[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [trash, setTrash] = useState<TrashedCase[]>([]);
  const [deleting, setDeleting] = useState<TestCase[] | null>(null);
  const running = Boolean(service.activeRun);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.testCases(service.id);
      setCases(r.cases);
      setErrors(r.errors);
      // A rewritten spec can drop a case; never keep a selection that no longer exists.
      setPicked((prev) => new Set([...prev].filter((id) => r.cases.some((c) => c.id === id))));
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setCases((c) => c ?? []);
    } finally {
      setLoading(false);
    }
  }, [service.id]);

  const loadTrash = useCallback(() => api.trash(service.id).then(setTrash, () => undefined), [service.id]);
  useEffect(() => void loadTrash(), [loadTrash, service.claudeWorking]);

  // Load on open, and again when Claude finishes writing (its turn ends, claudeWorking goes false).
  useEffect(() => void load(), [load, service.claudeWorking]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (cases ?? []).filter((c) => !q || `${c.title} ${c.feature} ${c.file} ${c.source ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(q)), [cases, q]);
  const groups = useMemo(() => {
    const by = new Map<string, TestCase[]>();
    for (const c of visible) by.set(c.feature, [...(by.get(c.feature) ?? []), c]);
    return [...by.entries()];
  }, [visible]);

  const setMany = (list: TestCase[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of list) (on ? next.add(c.id) : next.delete(c.id));
      return next;
    });
  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.id));

  const start = async (list: TestCase[] | null) => {
    const body = list ? { tests: list.map((c) => ({ file: c.file, line: c.line })), title: `${service.name} · 선택한 ${list.length}개` } : {};
    if (await attempt(() => api.startRun(service.id, body))) goService(service.id, 'monitor');
  };
  const remove = async (list: TestCase[]) => {
    const done = await attempt(() => api.deleteTests(service.id, list.map((c) => ({ file: c.file, line: c.line, title: c.title, feature: c.feature }))));
    if (done) setPicked(new Set());
    await Promise.all([load(), loadTrash()]);
  };
  const restore = async (item: TrashedCase) => {
    await attempt(() => api.restoreTrashed(service.id, item.id));
    await Promise.all([load(), loadTrash()]);
  };
  const chosen = (cases ?? []).filter((c) => picked.has(c.id));

  if (cases === null) return <div className="muted pad">테스트 목록을 읽는 중…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Claude가 작성한 테스트를 기능별로 모았습니다. 전체를 실행하거나 원하는 케이스만 골라 실행할 수 있습니다.</p>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" size={14} />
          새로고침
        </button>
      </div>

      {errors.length > 0 && (
        <div className="callout callout-warn">
          <div>
            <strong>일부 파일을 읽지 못했습니다.</strong>
            <pre className="case-error">{errors.join('\n\n')}</pre>
          </div>
        </div>
      )}

      {cases.length === 0 ? (
        <Empty
          title="아직 테스트 케이스가 없습니다"
          action={
            <a className="btn btn-primary" href={`#/s/${encodeURIComponent(service.id)}/sessions`}>
              Claude 세션에서 만들기
            </a>
          }
        >
          Claude 세션에서 <strong>테스트 작성</strong>을 누르면 지식 문서를 바탕으로 케이스가 만들어지고 여기에 나타납니다.
        </Empty>
      ) : (
        <>
          <div className="case-bar">
            <label className="case-check">
              <input type="checkbox" checked={allVisiblePicked} ref={(el) => void (el && (el.indeterminate = picked.size > 0 && !allVisiblePicked))} onChange={(e) => setMany(visible, e.target.checked)} aria-label="보이는 케이스 모두 선택" />
              <span>{picked.size ? `${picked.size}개 선택` : `${cases.length}개 케이스`}</span>
            </label>
            <input type="search" className="case-search" aria-label="케이스 검색" placeholder="제목, 기능, 근거로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="spacer" />
            <button className="btn btn-quiet" disabled={chosen.length === 0} onClick={() => setDeleting(chosen)}>
              <Icon name="trash" size={14} />
              선택 삭제
            </button>
            <button className="btn btn-primary" disabled={running || chosen.length === 0} onClick={() => void start(chosen)} title={running ? '다른 실행이 진행 중입니다' : undefined}>
              <Icon name="play" size={14} />
              선택한 {chosen.length}개 실행
            </button>
            <button className="btn" disabled={running} onClick={() => void start(null)} title={running ? '다른 실행이 진행 중입니다' : undefined}>
              전체 실행
            </button>
          </div>

          {visible.length === 0 && <p className="muted small">검색 결과가 없습니다.</p>}
          {groups.map(([feature, list]) => {
            const all = list.every((c) => picked.has(c.id));
            const some = list.some((c) => picked.has(c.id));
            return (
              <details key={feature} className="panel case-group" open>
                <summary>
                  <Icon name="chevron" size={14} />
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => void (el && (el.indeterminate = some && !all))}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setMany(list, e.target.checked)}
                    aria-label={`${feature} 전체 선택`}
                  />
                  <strong className="ellipsis">{feature}</strong>
                  <span className="count">{list.length}</span>
                </summary>
                <ul className="case-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <label className="case-row">
                        <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setMany([c], e.target.checked)} />
                        <span className="case-main">
                          <span className="case-title">
                            {c.title}
                            {c.tags.map((t) => (
                              <Pill key={t} tone="accent">
                                {t.replace(/^@/, '')}
                              </Pill>
                            ))}
                          </span>
                          {c.source && <span className="case-source">근거 · {c.source}</span>}
                        </span>
                        <code className="case-file">
                          {c.file}:{c.line}
                        </code>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}

      {trash.length > 0 && (
        <details className="panel case-trash">
          <summary>
            <Icon name="chevron" size={14} />
            <Icon name="trash" size={14} />
            <strong>휴지통</strong>
            <span className="count">{trash.length}</span>
          </summary>
          <ul className="case-list">
            {trash.map((t) => (
              <li key={t.id} className="case-row">
                <span className="case-main">
                  <span className="case-title">{t.whole ? `파일 전체 · ${t.file}` : t.title}</span>
                  <span className="case-source">{[t.whole ? '' : t.file, ago(t.deletedAt, Date.now())].filter(Boolean).join(' · ')}</span>
                </span>
                <button className="btn btn-sm" onClick={() => void restore(t)}>
                  복원
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => void attempt(() => api.emptyTrash(service.id, t.id)).then(loadTrash)}>
                  완전 삭제
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {deleting && (
        <ConfirmModal title="테스트 케이스 삭제" confirm="휴지통으로 이동" onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)}>
          {deleting.length}개 케이스를 테스트 파일에서 빼서 휴지통으로 옮깁니다. 아래 휴지통에서 언제든 복원할 수 있습니다.
        </ConfirmModal>
      )}
    </>
  );
}
